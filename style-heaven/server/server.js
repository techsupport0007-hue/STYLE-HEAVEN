require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const Razorpay = require('razorpay');

const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, '..')));

const PORT = Number(process.env.PORT || 3000);
const db = new DatabaseSync(path.join(__dirname, 'style-heaven.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  mobile TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  address_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  product_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  main_category TEXT NOT NULL,
  price INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 1,
  sizes_json TEXT NOT NULL,
  size_guide_json TEXT NOT NULL,
  description TEXT NOT NULL,
  fabric TEXT NOT NULL,
  colour TEXT NOT NULL,
  rating REAL NOT NULL,
  review_count INTEGER NOT NULL,
  reviews_json TEXT NOT NULL,
  image_url TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS wishlist (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, product_id)
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  subtotal INTEGER NOT NULL,
  shipping INTEGER NOT NULL,
  total INTEGER NOT NULL,
  payment_mode TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  shipping_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'placed',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  product_id_code TEXT NOT NULL,
  size TEXT,
  quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS otp_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  verified_purchase INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE(product_id,user_id,order_id)
);
CREATE TABLE IF NOT EXISTS enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  mobile TEXT,
  company TEXT,
  business_type TEXT,
  gstin TEXT,
  city TEXT,
  state TEXT,
  order_volume TEXT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

const now = () => new Date().toISOString();
const clean = (v) => String(v ?? '').trim();
const validEmail = (v) => /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(clean(v));
const validMobile = (v) => /^[6-9]\d{9}$/.test(clean(v));
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const makeToken = () => crypto.randomBytes(32).toString('hex');
const escapeHtml = (v) => clean(v).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]));

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}
function verifyPassword(password, stored) {
  const [salt, key] = String(stored).split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(key, 'hex'));
}
function createUserId() {
  for (;;) {
    const id = `SHU-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    if (!db.prepare('SELECT 1 FROM users WHERE user_id=?').get(id)) return id;
  }
}
function createOrderId() {
  for (;;) {
    const id = `SH-${new Date().toISOString().slice(2,10).replace(/-/g,'')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    if (!db.prepare('SELECT 1 FROM orders WHERE order_id=?').get(id)) return id;
  }
}
function authUser(req) {
  const header = clean(req.headers.authorization);
  if (!header.startsWith('Bearer ')) return null;
  const tokenHash = hash(header.slice(7));
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).get(tokenHash, Date.now());
  return row || null;
}
function requireAuth(req,res,next){ const user=authUser(req); if(!user) return res.status(401).json({success:false,error:'Please log in to continue.'}); req.user=user; next(); }

const RESEND_API_KEY = clean(process.env.RESEND_API_KEY);
const BREVO_API_KEY = clean(process.env.BREVO_API_KEY);
const FROM_EMAIL = clean(process.env.FROM_EMAIL) || 'Style Heaven <onboarding@resend.dev>';
const CUSTOMER_SUPPORT_EMAIL = clean(process.env.CUSTOMER_SUPPORT_EMAIL || process.env.SUPPORT_EMAIL) || 'support@styleheaven.example.com';
const MERCHANT_EMAIL = clean(process.env.MERCHANT_EMAIL || process.env.SUPPORT_EMAIL) || CUSTOMER_SUPPORT_EMAIL;
const ORDER_EMAIL = clean(process.env.ORDER_EMAIL || process.env.SUPPORT_EMAIL) || CUSTOMER_SUPPORT_EMAIL;

async function sendEmail({to,subject,html}) {
  if (BREVO_API_KEY) {
    const fromMatch = FROM_EMAIL.match(/^(.*?)\s*<([^>]+)>$/);
    const sender = fromMatch ? {name: fromMatch[1].trim() || 'Style Heaven', email: fromMatch[2].trim()} : {name:'Style Heaven', email:FROM_EMAIL};
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method:'POST',
      headers:{ 'api-key':BREVO_API_KEY, 'Content-Type':'application/json', 'accept':'application/json' },
      body:JSON.stringify({sender,to:[{email:to}],subject,htmlContent:html})
    });
    const data = await response.json().catch(()=>({}));
    if (!response.ok) throw new Error(data.message || data.code || 'Brevo email delivery failed');
    return data;
  }
  if (!RESEND_API_KEY) throw new Error('Email service is not configured. Add BREVO_API_KEY (recommended) or RESEND_API_KEY in server/.env.');
  const response = await fetch('https://api.resend.com/emails', { method:'POST', headers:{ Authorization:`Bearer ${RESEND_API_KEY}`, 'Content-Type':'application/json' }, body:JSON.stringify({from:FROM_EMAIL,to:[to],subject,html}) });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.message || 'Email delivery failed');
  return data;
}

const PRODUCT_SEED = [
  ['SH-WMN-0001','Ivory Pleated Midi Dress','Dresses','Women',2899,4,['XS','S','M','L','XL'],{XS:'Waist 26–28 in',S:'Waist 28–30 in',M:'Waist 30–32 in',L:'Waist 32–34 in',XL:'Waist 34–36 in'},'A softly structured midi dress with pleated movement and a polished day-to-evening silhouette.','Polyester crepe','Ivory','11411811'],
  ['SH-WMN-0002','Satin Evening Slip Dress','Dresses','Women',3299,3,['XS','S','M','L','XL'],{XS:'Waist 25–27 in',S:'Waist 27–29 in',M:'Waist 29–31 in',L:'Waist 31–33 in',XL:'Waist 33–35 in'},'A fluid satin slip dress designed with a clean neckline and an easy evening drape.','Satin blend','Champagne','3848175'],
  ['SH-WMN-0003','Garden Print Wrap Dress','Dresses','Women',2499,5,['S','M','L','XL'],{S:'Waist 28–30 in',M:'Waist 30–32 in',L:'Waist 32–34 in',XL:'Waist 34–36 in'},'A feminine wrap silhouette with a soft floral print and adjustable waist tie.','Viscose rayon','Blush Floral','4541910'],
  ['SH-WMN-0004','Statement Chain Detail Dress','Dresses','Women',3599,2,['S','M','L','XL'],{S:'Waist 28–30 in',M:'Waist 30–32 in',L:'Waist 32–34 in',XL:'Waist 34–36 in'},'A contemporary occasion dress finished with a refined statement detail at the neckline.','Crepe blend','Black','19230101'],
  ['SH-MEN-0001','Classic Blue Casual Shirt','Tops & Shirts','Men',1599,6,['S','M','L','XL','XXL'],{S:'Chest 38–40 in',M:'Chest 40–42 in',L:'Chest 42–44 in',XL:'Chest 44–46 in',XXL:'Chest 46–48 in'},'A versatile casual shirt with a relaxed everyday fit, made for denim and chinos.','Cotton blend','Sky Blue','8542355'],
  ['SH-MEN-0002','Indigo Denim Overshirt','Tops & Shirts','Men',2299,4,['S','M','L','XL','XXL'],{S:'Chest 38–40 in',M:'Chest 40–42 in',L:'Chest 42–44 in',XL:'Chest 44–46 in',XXL:'Chest 46–48 in'},'A mid-weight denim overshirt with utility-inspired styling and an easy layered fit.','Cotton denim','Indigo','10004177'],
  ['SH-MEN-0003','Relaxed Weekend Shirt','Tops & Shirts','Men',1799,5,['S','M','L','XL'],{S:'Chest 38–40 in',M:'Chest 40–42 in',L:'Chest 42–44 in',XL:'Chest 44–46 in'},'A relaxed shirt built for weekends, travel and casual city dressing.','Cotton linen blend','Sand','14048722'],
  ['SH-MEN-0004','Textured Everyday Shirt','Tops & Shirts','Men',1699,3,['S','M','L','XL','XXL'],{S:'Chest 38–40 in',M:'Chest 40–42 in',L:'Chest 42–44 in',XL:'Chest 44–46 in',XXL:'Chest 46–48 in'},'A textured everyday shirt with a clean collar and modern regular fit.','Cotton texture weave','White','13371358'],
  ['SH-MEN-0005','Premium Cotton Shirt','Tops & Shirts','Men',1899,4,['S','M','L','XL'],{S:'Chest 38–40 in',M:'Chest 40–42 in',L:'Chest 42–44 in',XL:'Chest 44–46 in'},'A premium cotton shirt with a crisp finish for workdays and evenings.','100% cotton','Charcoal','5701702'],
  ['SH-MEN-0006','Washed Denim Shirt','Tops & Shirts','Men',1999,2,['S','M','L','XL','XXL'],{S:'Chest 38–40 in',M:'Chest 40–42 in',L:'Chest 42–44 in',XL:'Chest 44–46 in',XXL:'Chest 46–48 in'},'A washed denim shirt with a comfortable structure and classic button front.','Cotton denim','Washed Blue','15870246'],
  ['SH-WMN-0005','Festive Banarasi Saree','Sarees','Women',4999,2,['Free Size'],{'Free Size':'Saree length 5.5 m + blouse piece'},'A festive saree-inspired edit with a rich drape and traditional occasion appeal.','Silk blend','Wine','13192043'],
  ['SH-WMN-0006','Organza Floral Saree','Sarees','Women',3999,3,['Free Size'],{'Free Size':'Saree length 5.5 m + blouse piece'},'A lightweight organza saree with a floral surface and graceful occasion drape.','Organza blend','Rose','15226362'],
  ['SH-WMN-0007','Classic Drape Saree','Sarees','Women',3499,4,['Free Size'],{'Free Size':'Saree length 5.5 m + blouse piece'},'A classic saree silhouette designed for celebrations and refined festive dressing.','Georgette blend','Emerald','13162248'],
  ['SH-WMN-0008','Printed Chiffon Saree','Sarees','Women',2899,5,['Free Size'],{'Free Size':'Saree length 5.5 m + blouse piece'},'A light printed chiffon saree with an effortless drape for day celebrations.','Chiffon blend','Coral Print','11555724'],
  ['SH-WMN-0009','Handloom-Inspired Saree','Sarees','Women',3799,3,['Free Size'],{'Free Size':'Saree length 5.5 m + blouse piece'},'A handloom-inspired saree with a tactile surface and understated border detailing.','Cotton silk','Mustard','2723623'],
  ['SH-WMN-0010','Embroidered Festive Saree','Sarees','Women',4599,2,['Free Size'],{'Free Size':'Saree length 5.5 m + blouse piece'},'An embellished festive drape designed for weddings, dinners and celebrations.','Georgette blend','Rose Gold','13162244'],
  ['SH-KID-0001','Kids Weekend Co-ord Set','Kids Wear','Kids',1299,4,['2Y','4Y','6Y','8Y','10Y'],{'2Y':'Height 86–92 cm','4Y':'Height 98–104 cm','6Y':'Height 110–116 cm','8Y':'Height 122–128 cm','10Y':'Height 134–140 cm'},'A comfortable everyday co-ord for active weekends and casual outings.','Cotton blend','Blue','14622650'],
  ['SH-KID-0002','Kids Floral Party Dress','Kids Wear','Kids',1499,3,['2Y','4Y','6Y','8Y'],{'2Y':'Height 86–92 cm','4Y':'Height 98–104 cm','6Y':'Height 110–116 cm','8Y':'Height 122–128 cm'},'A cheerful party dress with a playful silhouette for family occasions.','Cotton blend','Pink Floral','14622835'],
  ['SH-KID-0003','Kids Casual Day Dress','Kids Wear','Kids',1199,5,['2Y','4Y','6Y','8Y'],{'2Y':'Height 86–92 cm','4Y':'Height 98–104 cm','6Y':'Height 110–116 cm','8Y':'Height 122–128 cm'},'A lightweight casual dress designed for comfortable everyday wear.','Cotton jersey','Sky Blue','14622692'],
  ['SH-KID-0004','Kids Smart Casual Set','Kids Wear','Kids',1399,4,['4Y','6Y','8Y','10Y','12Y'],{'4Y':'Height 98–104 cm','6Y':'Height 110–116 cm','8Y':'Height 122–128 cm','10Y':'Height 134–140 cm','12Y':'Height 146–152 cm'},'A smart-casual two-piece look for family gatherings and special days.','Cotton blend','Neutral','14578156'],
  ['SH-KID-0005','Kids Hoodie & Jogger Set','Kids Wear','Kids',1599,3,['4Y','6Y','8Y','10Y','12Y'],{'4Y':'Height 98–104 cm','6Y':'Height 110–116 cm','8Y':'Height 122–128 cm','10Y':'Height 134–140 cm','12Y':'Height 146–152 cm'},'A soft hoodie and jogger combination designed for easy movement and cooler days.','Fleece cotton blend','Olive','32069221'],
  ['SH-ACC-0001','Structured Everyday Tote','Bags','Accessories',1999,4,['One Size'],{'One Size':'Approx. 32 × 25 × 12 cm'},'A structured tote with a clean profile for everyday essentials and workwear.','Faux leather','Tan','5791936'],
  ['SH-ACC-0002','Quilted Shoulder Bag','Bags','Accessories',1699,3,['One Size'],{'One Size':'Approx. 24 × 16 × 8 cm'},'A compact quilted shoulder bag designed for evenings and smart-casual looks.','Faux leather','Black','10280614'],
  ['SH-ACC-0003','Classic Handheld Bag','Bags','Accessories',1899,5,['One Size'],{'One Size':'Approx. 28 × 22 × 11 cm'},'A polished handheld bag with an everyday silhouette and practical interior space.','Faux leather','Beige','7944717'],
  ['SH-ACC-0004','Minimal Structured Handbag','Bags','Accessories',2199,2,['One Size'],{'One Size':'Approx. 30 × 23 × 12 cm'},'A minimal structured handbag designed to complement refined daywear.','Vegan leather','Taupe','6120155'],
  ['SH-ACC-0005','Soft Carryall Bag','Bags','Accessories',1799,4,['One Size'],{'One Size':'Approx. 35 × 28 × 13 cm'},'A spacious carryall with a soft silhouette for daily commuting and travel.','Canvas blend','Cream','8006405'],
  ['SH-ACC-0006','Classic Court Heels','Footwear','Fashion',2499,3,['36','37','38','39','40'],{'36':'Foot length 23.0 cm','37':'Foot length 23.7 cm','38':'Foot length 24.3 cm','39':'Foot length 25.0 cm','40':'Foot length 25.7 cm'},'Classic court heels with a clean profile for occasion and workwear styling.','Synthetic upper','Black','11324518'],
  ['SH-ACC-0007','Everyday White Sneakers','Footwear','Fashion',2299,5,['36','37','38','39','40','41'],{'36':'Foot length 23.0 cm','37':'Foot length 23.7 cm','38':'Foot length 24.3 cm','39':'Foot length 25.0 cm','40':'Foot length 25.7 cm','41':'Foot length 26.3 cm'},'Clean everyday sneakers designed for casual outfits and city wear.','Synthetic leather','White','19960565'],
  ['SH-ACC-0008','Strappy Occasion Sandals','Footwear','Fashion',1999,4,['36','37','38','39','40'],{'36':'Foot length 23.0 cm','37':'Foot length 23.7 cm','38':'Foot length 24.3 cm','39':'Foot length 25.0 cm','40':'Foot length 25.7 cm'},'A refined strappy sandal silhouette for dinners, celebrations and festive looks.','Synthetic upper','Gold','6847398'],
  ['SH-ACC-0009','Minimal Ankle Boots','Footwear','Fashion',2999,2,['36','37','38','39','40'],{'36':'Foot length 23.0 cm','37':'Foot length 23.7 cm','38':'Foot length 24.3 cm','39':'Foot length 25.0 cm','40':'Foot length 25.7 cm'},'A clean ankle-boot profile for cooler-season styling and evening looks.','Synthetic upper','Black','9214975'],
  ['SH-ACC-0010','Everyday Flat Shoes','Footwear','Fashion',1599,6,['36','37','38','39','40','41'],{'36':'Foot length 23.0 cm','37':'Foot length 23.7 cm','38':'Foot length 24.3 cm','39':'Foot length 25.0 cm','40':'Foot length 25.7 cm','41':'Foot length 26.3 cm'},'Comfortable everyday flats with a simple silhouette for repeat wear.','Synthetic upper','Neutral','14212621']
];
const imageUrl = id => `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=900`;
function seedProducts(){
  const count = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  const ins = db.prepare(`INSERT OR IGNORE INTO products (id,product_id,name,category,main_category,price,stock,sizes_json,size_guide_json,description,fabric,colour,rating,review_count,reviews_json,image_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const reviews=[];
  if(count===0){
    for(let i=0;i<PRODUCT_SEED.length;i++){
      const p=PRODUCT_SEED[i];
      ins.run(i+1,p[0],p[1],p[2],p[3],p[4],p[5],JSON.stringify(p[6]),JSON.stringify(p[7]),p[8],p[9],p[10],+(4.2+((i*7)%8)/10).toFixed(1),0,JSON.stringify(reviews),imageUrl(p[11]));
    }
  }
  const total=db.prepare('SELECT COUNT(*) c FROM products').get().c;
  if(total>=200)return;
  const generated=buildGeneratedProducts(200-total);
  for(const p of generated){
    ins.run(p.id,p.productId,p.name,p.category,p.mainCategory,p.price,p.stock,JSON.stringify(p.sizes),JSON.stringify(p.sizeGuide),p.description,p.fabric,p.colour,p.rating,p.reviewCount,JSON.stringify(reviews),p.image);
  }
}
function buildGeneratedProducts(limit){
  const rows=[]; let id=db.prepare('SELECT COALESCE(MAX(id),0) m FROM products').get().m+1;
  const plans=[
    ['Women','Dresses','Midi Dress','Premium rayon',2599,['XS','S','M','L','XL'],'dress'],
    ['Women','Tops & Shirts','Relaxed Shirt','Cotton poplin',1799,['XS','S','M','L','XL'],'top'],
    ['Women','Bottoms','Wide-Leg Trousers','Viscose blend',2299,['XS','S','M','L','XL'],'bottom'],
    ['Women','Kurtas','Straight Kurta','Cotton rayon',1999,['S','M','L','XL','XXL'],'kurta'],
    ['Women','Co-ords','Tailored Co-ord Set','Linen blend',2999,['XS','S','M','L','XL'],'coord'],
    ['Men','Tops & Shirts','Regular Fit Shirt','100% cotton',1899,['S','M','L','XL','XXL'],'shirt'],
    ['Men','Trousers','Tapered Trousers','Cotton stretch',2199,['30','32','34','36','38','40'],'trouser'],
    ['Men','Outerwear','Lightweight Overshirt','Cotton twill',2499,['S','M','L','XL','XXL'],'outer'],
    ['Men','Kurtas','Textured Kurta','Cotton slub',1999,['S','M','L','XL','XXL'],'kurta'],
    ['Kids','Kids Wear','Everyday Co-ord Set','Cotton blend',1399,['2Y','4Y','6Y','8Y','10Y','12Y'],'kids'],
    ['Kids','Kids Wear','Festive Kurta Set','Cotton silk blend',1699,['2Y','4Y','6Y','8Y','10Y','12Y'],'kids'],
    ['Kids','Kids Wear','Printed Day Dress','Cotton poplin',1299,['2Y','4Y','6Y','8Y','10Y'],'kids'],
    ['Fashion','Co-ords','Weekend Co-ord Set','Cotton linen blend',2499,['XS','S','M','L','XL'],'coord'],
    ['Fashion','Layering','Textured Shacket','Cotton twill',2799,['S','M','L','XL','XXL'],'outer'],
    ['Fashion','Accessories','Statement Belt','Vegan leather',999,['28','30','32','34','36'],'belt'],
    ['Fashion','Accessories','Everyday Sunglasses','Acetate blend',1299,['One Size'],'glasses'],
    ['Fashion','Footwear','Minimal Lifestyle Sneakers','Synthetic leather',2399,['36','37','38','39','40','41'],'shoe'],
    ['Accessories','Bags','Structured Crossbody Bag','Vegan leather',1799,['One Size'],'bag'],
    ['Accessories','Jewellery','Layered Pendant Set','Stainless steel',1199,['One Size'],'jewellery'],
    ['Accessories','Scarves','Printed Modal Stole','Modal blend',899,['One Size'],'scarf']
  ];
  const colours=['Ivory','Midnight','Olive','Sand','Rose','Terracotta','Stone','Navy','Forest','Wine','Sky','Black','Cream','Cocoa'];
  const descriptors=['Everyday','Refined','Relaxed','Modern','Classic','Tailored','Soft-touch','Textured','Essential','Signature'];
  const fabrics=['Premium cotton','Rayon twill','Linen blend','Cotton poplin','Modal blend','Viscose blend','Cotton slub','Tencel blend','Satin blend','Organic cotton'];
  for(let n=0;n<limit;n++){
    const plan=plans[n%plans.length]; const [main,category,base,fabric,basePrice,sizes,type]=plan;
    const seq=id; const colour=colours[n%colours.length]; const descriptor=descriptors[n%descriptors.length];
    const name=`${descriptor} ${colour} ${base}`;
    let guide={};
    for(const z of sizes){
      if(/^\d+Y$/.test(z)){const y=Number(z.slice(0,-1));guide[z]=`Height ${86+y*5}–${92+y*5} cm`;}
      else if(/^\d+$/.test(z)){const waist=Number(z);guide[z]=`Waist ${waist}–${waist+2} in`;}
      else if(z==='One Size') guide[z]=type==='bag'?'Approx. 28 × 20 × 10 cm':type==='scarf'?'Approx. 180 × 70 cm':'One adjustable size';
      else guide[z]=main==='Men'?`Chest ${z==='S'?'38–40':z==='M'?'40–42':z==='L'?'42–44':z==='XL'?'44–46':'46–48'} in`:`Waist ${z==='XS'?'26–28':z==='S'?'28–30':z==='M'?'30–32':z==='L'?'32–34':'34–36'} in`;
    }
    const image=`/catalog/SH26-${String(seq).padStart(5,'0')}.svg`;
    rows.push({id:seq,productId:`SH26-${String(seq).padStart(5,'0')}`,name,category,mainCategory:main,price:basePrice+((n%6)*100),stock:1+(n%5),sizes,sizeGuide:guide,description:`A ${descriptor.toLowerCase()} ${base.toLowerCase()} selected for the Style Heaven collection. Designed for easy Indian wardrobes, dependable comfort and repeat wear, with a considered finish that works from everyday plans to occasion dressing.`,fabric:fabric||fabrics[n%fabrics.length],colour,rating:Number((4.2+(n%7)*0.1).toFixed(1)),reviewCount:0,image});
    id++;
  }
  return rows;
}
seedProducts();

function productRow(row){ return {...row, sizes:JSON.parse(row.sizes_json), sizeGuide:JSON.parse(row.size_guide_json), reviews:JSON.parse(row.reviews_json), image:row.image_url, productId:row.product_id, mainCat:row.main_category}; }

app.get('/api/products',(req,res)=>{
  const cat=clean(req.query.cat);
  const rows=cat&&cat!=='All'?db.prepare('SELECT * FROM products WHERE main_category=? ORDER BY id').all(cat):db.prepare('SELECT * FROM products ORDER BY id').all();
  res.json({products:rows.map(productRow)});
});
app.get('/api/products/:id',(req,res)=>{
  const row=db.prepare('SELECT * FROM products WHERE id=? OR product_id=?').get(req.params.id,req.params.id);
  if(!row) return res.status(404).json({error:'Product not found'});
  res.json({product:productRow(row)});
});

app.post('/api/auth/send-email-otp',async(req,res)=>{
  try{
    const email=clean(req.body.email).toLowerCase(); const purpose=clean(req.body.purpose)||'signup';
    if(!validEmail(email)) return res.status(400).json({success:false,error:'Enter a valid email address.'});
    if(purpose==='signup' && db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return res.status(409).json({success:false,error:'An account with this email already exists.'});
    if(purpose!=='signup' && purpose!=='password-reset' && purpose!=='login') return res.status(400).json({success:false,error:'Invalid OTP purpose.'});
    if((purpose==='password-reset'||purpose==='login') && !db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return res.status(404).json({success:false,error:'No Style Heaven account was found with this email.'});
    const otp=String(crypto.randomInt(100000,1000000));
    db.prepare('DELETE FROM otp_codes WHERE email=? AND purpose=?').run(email,purpose);
    db.prepare('INSERT INTO otp_codes(email,purpose,code_hash,expires_at,attempts,created_at) VALUES(?,?,?,?,0,?)').run(email,purpose,hash(otp),Date.now()+10*60*1000,now());
    const subject=purpose==='signup'?'Verify your Style Heaven account':purpose==='login'?'Your Style Heaven login code':'Reset your Style Heaven password';
    await sendEmail({to:email,subject,html:`<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Style Heaven</h2><p>Your one-time verification code is:</p><div style="font-size:30px;font-weight:700;letter-spacing:8px;margin:18px 0">${otp}</div><p>This code expires in 10 minutes.</p></div>`});
    res.json({success:true,message:'OTP sent to your email.'});
  }catch(e){console.error(e);res.status(500).json({success:false,error:e.message});}
});

function consumeOtp(email,purpose,code){
  const row=db.prepare('SELECT * FROM otp_codes WHERE email=? AND purpose=? ORDER BY id DESC LIMIT 1').get(email,purpose);
  if(!row) return {ok:false,error:'OTP expired or not requested.'};
  if(Date.now()>row.expires_at){db.prepare('DELETE FROM otp_codes WHERE id=?').run(row.id);return {ok:false,error:'OTP expired. Request a new code.'};}
  if(row.attempts>=5){db.prepare('DELETE FROM otp_codes WHERE id=?').run(row.id);return {ok:false,error:'Too many attempts. Request a new code.'};}
  db.prepare('UPDATE otp_codes SET attempts=attempts+1 WHERE id=?').run(row.id);
  if(hash(code)!==row.code_hash) return {ok:false,error:'Invalid OTP.'};
  db.prepare('DELETE FROM otp_codes WHERE id=?').run(row.id); return {ok:true};
}
function createSession(userId){const token=makeToken();db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(hash(token),userId,Date.now()+30*24*60*60*1000,now());return token;}
function publicUser(u){return {id:u.id,userId:u.user_id,name:u.name,email:u.email,mobile:u.mobile,emailVerified:!!u.email_verified,address:JSON.parse(u.address_json||'{}')};}

app.post('/api/auth/signup', (req,res)=>{
  try{
    const name=clean(req.body.name),email=clean(req.body.email).toLowerCase(),mobile=clean(req.body.mobile),password=String(req.body.password||'');
    if(name.length<2||!validEmail(email)||!validMobile(mobile)||password.length<8) return res.status(400).json({success:false,error:'Enter a valid name, email, mobile number and password of at least 8 characters.'});
    if(db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return res.status(409).json({success:false,error:'An account with this email already exists.'});
    const info=db.prepare('INSERT INTO users(user_id,name,email,mobile,password_hash,email_verified,address_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(createUserId(),name,email,mobile,hashPassword(password),1,'{}',now());
    const user=db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid); const token=createSession(user.id);
    res.json({success:true,token,user:publicUser(user)});
  }catch(e){console.error(e);res.status(500).json({success:false,error:'Unable to create account.'});}
});

app.post('/api/auth/login',(req,res)=>{
  const email=clean(req.body.email).toLowerCase(),password=String(req.body.password||'');
  const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if(!user||!verifyPassword(password,user.password_hash))return res.status(401).json({success:false,error:'Email or password is incorrect.'});
  const token=createSession(user.id);res.json({success:true,token,user:publicUser(user)});
});
app.post('/api/auth/login-otp',(req,res)=>{
  const email=clean(req.body.email).toLowerCase(),code=clean(req.body.code); const result=consumeOtp(email,'login',code); if(!result.ok)return res.status(400).json({success:false,error:result.error});
  const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);if(!user)return res.status(404).json({success:false,error:'Account not found.'}); const token=createSession(user.id);res.json({success:true,token,user:publicUser(user)});
});
app.post('/api/auth/reset-password',(req,res)=>{
  const email=clean(req.body.email).toLowerCase(),code=clean(req.body.code),password=String(req.body.password||''); if(password.length<8)return res.status(400).json({success:false,error:'Password must be at least 8 characters.'});
  const result=consumeOtp(email,'password-reset',code);if(!result.ok)return res.status(400).json({success:false,error:result.error});
  const user=db.prepare('SELECT id FROM users WHERE email=?').get(email);if(!user)return res.status(404).json({success:false,error:'Account not found.'});
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password),user.id);res.json({success:true});
});
app.post('/api/auth/reset-password-local',(req,res)=>{
  const email=clean(req.body.email).toLowerCase(),mobile=clean(req.body.mobile),password=String(req.body.password||'');
  if(!validEmail(email)||!validMobile(mobile)||password.length<8)return res.status(400).json({success:false,error:'Enter the registered email, mobile number and a password of at least 8 characters.'});
  const user=db.prepare('SELECT id FROM users WHERE email=? AND mobile=?').get(email,mobile);
  if(!user)return res.status(404).json({success:false,error:'Email and mobile number do not match our local account.'});
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password),user.id);
  res.json({success:true,message:'Password updated successfully. You can now log in.'});
});
app.get('/api/auth/me',requireAuth,(req,res)=>res.json({success:true,user:publicUser(req.user)}));
app.post('/api/auth/logout',requireAuth,(req,res)=>{const token=clean(req.headers.authorization).slice(7);db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));res.json({success:true});});
app.put('/api/profile',requireAuth,(req,res)=>{
  const allowed={address:clean(req.body.address),city:clean(req.body.city),state:clean(req.body.state),pin:clean(req.body.pin),area:clean(req.body.area),latitude:req.body.latitude===''||req.body.latitude==null?null:Number(req.body.latitude),longitude:req.body.longitude===''||req.body.longitude==null?null:Number(req.body.longitude),deliveryNote:clean(req.body.deliveryNote)};
  if(allowed.pin && !/^[1-9]\d{5}$/.test(allowed.pin))return res.status(400).json({success:false,error:'Enter a valid 6-digit pincode.'});
  db.prepare('UPDATE users SET address_json=? WHERE id=?').run(JSON.stringify(allowed),req.user.id);const u=db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);res.json({success:true,user:publicUser(u)});
});

app.get('/api/wishlist',requireAuth,(req,res)=>{const rows=db.prepare('SELECT p.* FROM wishlist w JOIN products p ON p.id=w.product_id WHERE w.user_id=? ORDER BY w.created_at DESC').all(req.user.id);res.json({products:rows.map(productRow)});});
app.post('/api/wishlist/:productId',requireAuth,(req,res)=>{const p=db.prepare('SELECT id FROM products WHERE id=? OR product_id=?').get(req.params.productId,req.params.productId);if(!p)return res.status(404).json({success:false,error:'Product not found.'});db.prepare('INSERT OR IGNORE INTO wishlist(user_id,product_id,created_at) VALUES(?,?,?)').run(req.user.id,p.id,now());res.json({success:true});});
app.delete('/api/wishlist/:productId',requireAuth,(req,res)=>{const p=db.prepare('SELECT id FROM products WHERE id=? OR product_id=?').get(req.params.productId,req.params.productId);if(p)db.prepare('DELETE FROM wishlist WHERE user_id=? AND product_id=?').run(req.user.id,p.id);res.json({success:true});});

function calculateCart(items){
  if(!Array.isArray(items)||!items.length) throw new Error('Your bag is empty.');
  let subtotal=0;const normalized=[];
  for(const item of items){const id=Number(item.id),qty=Math.max(1,Math.min(20,Number(item.qty)||1));const p=db.prepare('SELECT * FROM products WHERE id=?').get(id);if(!p)throw new Error('A product in your bag is no longer available.');if(qty>p.stock)throw new Error(`${p.name} has only ${p.stock} left.`);const size=clean(item.size)||JSON.parse(p.sizes_json)[0];if(!JSON.parse(p.sizes_json).includes(size))throw new Error(`Invalid size for ${p.name}.`);subtotal+=p.price*qty;normalized.push({p,qty,size});}
  const shipping=subtotal>=2500?0:100;return {normalized,subtotal,shipping,total:subtotal+shipping};
}
function shippingPayload(body){const s=body.shipping||{};if(clean(s.name).length<2||!validMobile(s.phone)||!validEmail(s.email)||clean(s.address).length<5||clean(s.city).length<2||!/^[1-9]\d{5}$/.test(clean(s.pin)))throw new Error('Please provide valid delivery details.');return {name:clean(s.name),phone:clean(s.phone),email:clean(s.email).toLowerCase(),address:clean(s.address),area:clean(s.area),city:clean(s.city),state:clean(s.state),pin:clean(s.pin),latitude:s.latitude===''||s.latitude==null?null:Number(s.latitude),longitude:s.longitude===''||s.longitude==null?null:Number(s.longitude)};}
function createDbOrder({user,cart,shipping,paymentMode,paymentStatus,razorpayOrderId,razorpayPaymentId}){
  const calc=calculateCart(cart),orderId=createOrderId();
  const info=db.prepare('INSERT INTO orders(order_id,user_id,subtotal,shipping,total,payment_mode,payment_status,razorpay_order_id,razorpay_payment_id,shipping_json,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(orderId,user.id,calc.subtotal,calc.shipping,calc.total,paymentMode,paymentStatus,razorpayOrderId||null,razorpayPaymentId||null,JSON.stringify(shipping),'placed',now());
  const ins=db.prepare('INSERT INTO order_items(order_id,product_id,product_name,product_id_code,size,quantity,unit_price) VALUES(?,?,?,?,?,?,?)');
  const dec=db.prepare('UPDATE products SET stock=stock-? WHERE id=?');
  for(const line of calc.normalized){ins.run(info.lastInsertRowid,line.p.id,line.p.name,line.p.product_id,line.size,line.qty,line.p.price);dec.run(line.qty,line.p.id);}
  return {orderId,total:calc.total,subtotal:calc.subtotal,shipping:calc.shipping};
}

let razorpay=null;const keyId=clean(process.env.RAZORPAY_KEY_ID),keySecret=clean(process.env.RAZORPAY_KEY_SECRET);if(keyId&&keySecret)razorpay=new Razorpay({key_id:keyId,key_secret:keySecret});
app.post('/api/payment/create-order',requireAuth,async(req,res)=>{try{if(!razorpay)return res.status(500).json({error:'Razorpay test keys are not configured on the server.'});const calc=calculateCart(req.body.items);const receipt=`SH-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;const order=await razorpay.orders.create({amount:calc.total*100,currency:'INR',receipt,payment_capture:1});res.json({id:order.id,amount:order.amount,currency:order.currency,keyId});}catch(e){console.error(e);res.status(400).json({error:e.message});}});
app.post('/api/payment/verify',requireAuth,async(req,res)=>{try{const {razorpay_order_id,razorpay_payment_id,razorpay_signature}=req.body;if(!keySecret)return res.status(500).json({verified:false,error:'Razorpay secret is not configured.'});const expected=crypto.createHmac('sha256',keySecret).update(razorpay_order_id+'|'+razorpay_payment_id).digest('hex');if(expected!==razorpay_signature)return res.status(400).json({verified:false,error:'Payment verification failed.'});const shipping=shippingPayload(req.body);const result=createDbOrder({user:req.user,cart:req.body.items,shipping,paymentMode:'Razorpay Online',paymentStatus:'paid',razorpayOrderId:razorpay_order_id,razorpayPaymentId:razorpay_payment_id});sendEmail({to:ORDER_EMAIL,subject:`New Style Heaven order ${result.orderId}`,html:`<p>New online order <b>${result.orderId}</b> for ${result.total} INR.</p><p>Customer: ${escapeHtml(req.user.name)} (${escapeHtml(req.user.email)})</p>`}).catch(console.error);res.json({verified:true,order:result});}catch(e){console.error(e);res.status(400).json({verified:false,error:e.message});}});
app.post('/api/orders/cod',requireAuth,(req,res)=>{try{const shipping=shippingPayload(req.body);const result=createDbOrder({user:req.user,cart:req.body.items,shipping,paymentMode:'Cash on Delivery',paymentStatus:'pending'});sendEmail({to:ORDER_EMAIL,subject:`New Style Heaven COD order ${result.orderId}`,html:`<p>New COD order <b>${result.orderId}</b> for ${result.total} INR.</p><p>Customer: ${escapeHtml(req.user.name)} (${escapeHtml(req.user.email)})</p>`}).catch(console.error);res.json({success:true,order:result});}catch(e){console.error(e);res.status(400).json({success:false,error:e.message});}});

app.get('/api/orders',requireAuth,(req,res)=>{const rows=db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC').all(req.user.id);const items=db.prepare('SELECT * FROM order_items WHERE order_id=?');res.json({orders:rows.map(o=>({...o,shipping:JSON.parse(o.shipping_json),items:items.all(o.id).map(i=>({productId:i.product_id,productIdCode:i.product_id_code,name:i.product_name,size:i.size,qty:i.quantity,price:i.unit_price}))}))});});


app.get('/api/products/:id/reviews',(req,res)=>{const p=db.prepare('SELECT id FROM products WHERE id=? OR product_id=?').get(req.params.id,req.params.id);if(!p)return res.status(404).json({success:false,error:'Product not found.'});const rows=db.prepare(`SELECT r.*,u.name FROM reviews r JOIN users u ON u.id=r.user_id WHERE r.product_id=? ORDER BY r.id DESC`).all(p.id);const summary=db.prepare('SELECT COUNT(*) c, COALESCE(AVG(rating),0) avg FROM reviews WHERE product_id=?').get(p.id);res.json({reviews:rows.map(r=>({id:r.id,name:r.name,rating:r.rating,title:r.title,body:r.body,verifiedPurchase:!!r.verified_purchase,createdAt:r.created_at})),count:summary.c,rating:Number(summary.avg||0)});});
app.post('/api/products/:id/reviews',requireAuth,(req,res)=>{try{const p=db.prepare('SELECT id,name FROM products WHERE id=? OR product_id=?').get(req.params.id,req.params.id);if(!p)return res.status(404).json({success:false,error:'Product not found.'});const order=db.prepare(`SELECT o.id,o.order_id FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.user_id=? AND oi.product_id=? AND o.status='delivered' LIMIT 1`).get(req.user.id,p.id);if(!order)return res.status(403).json({success:false,error:'Reviews are available after a delivered purchase.'});const rating=Number(req.body.rating),title=clean(req.body.title),body=clean(req.body.body);if(!Number.isInteger(rating)||rating<1||rating>5||title.length<3||body.length<5)return res.status(400).json({success:false,error:'Please provide a rating, title and review.'});db.prepare('INSERT INTO reviews(product_id,user_id,order_id,rating,title,body,verified_purchase,created_at) VALUES(?,?,?,?,?,?,1,?)').run(p.id,req.user.id,order.id,rating,title,body,now());const sum=db.prepare('SELECT COUNT(*) c,AVG(rating) avg FROM reviews WHERE product_id=?').get(p.id);db.prepare('UPDATE products SET rating=?,review_count=? WHERE id=?').run(Number(sum.avg||0),sum.c,p.id);res.json({success:true,message:'Thank you. Your verified review has been submitted.'});}catch(e){res.status(400).json({success:false,error:e.message.includes('UNIQUE')?'You have already reviewed this purchase.':e.message});}});

app.post('/api/contact',async(req,res)=>{try{const type=clean(req.body.type)||'customer',name=clean(req.body.name),email=clean(req.body.email).toLowerCase(),mobile=clean(req.body.mobile),company=clean(req.body.company),businessType=clean(req.body.businessType),gstin=clean(req.body.gstin),city=clean(req.body.city),state=clean(req.body.state),orderVolume=clean(req.body.orderVolume),category=clean(req.body.category),issue=clean(req.body.issue),orderId=clean(req.body.orderId),pin=clean(req.body.pin),area=clean(req.body.area),message=clean(req.body.message);
    if(type==='customer' && ['refund','damage','incorrect'].includes(issue) && !orderId)return res.status(400).json({success:false,error:'Order ID is required for refund, damage or incorrect-item claims.'});if(name.length<2||!validEmail(email)||message.length<5)return res.status(400).json({success:false,error:'Name, valid email and message are required.'});db.prepare('INSERT INTO enquiries(type,name,email,mobile,company,business_type,gstin,city,state,order_volume,message,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(type,name,email,mobile,company,businessType,gstin,city,state,orderVolume,JSON.stringify({category,issue,orderId,pin,area,message}),now());const recipient=type==='merchant'?MERCHANT_EMAIL:CUSTOMER_SUPPORT_EMAIL;await sendEmail({to:recipient,subject:type==='merchant'?`Style Heaven merchant enquiry — ${company||name}`:`Style Heaven customer support — ${name}`,html:`<div style="font-family:Arial;line-height:1.6"><h2>${type==='merchant'?'Merchant enquiry':'Customer support enquiry'}</h2><p><b>Name:</b> ${escapeHtml(name)}</p><p><b>Email:</b> ${escapeHtml(email)}</p><p><b>Mobile:</b> ${escapeHtml(mobile||'—')}</p><p><b>Company:</b> ${escapeHtml(company||'—')}</p><p><b>GSTIN:</b> ${escapeHtml(gstin||'—')}</p><p><b>Business type:</b> ${escapeHtml(businessType||'—')}</p><p><b>Location:</b> ${escapeHtml(area||'—')}, ${escapeHtml(city||'—')}, ${escapeHtml(state||'—')} · PIN ${escapeHtml(pin||'—')}</p><p><b>Expected volume:</b> ${escapeHtml(orderVolume||'—')}</p><p><b>Category:</b> ${escapeHtml(category||'—')}</p><p><b>Issue:</b> ${escapeHtml(issue||'—')}</p><p><b>Order ID:</b> ${escapeHtml(orderId||'—')}</p><p><b>Message:</b><br>${escapeHtml(message).replace(/\n/g,'<br>')}</p></div>`});res.json({success:true});}catch(e){console.error(e);res.status(500).json({success:false,error:e.message});}});


app.get('/api/location/pincode/:pin', async (req,res)=>{
  const pin=clean(req.params.pin);
  if(!/^[1-9]\d{5}$/.test(pin)) return res.status(400).json({success:false,error:'Enter a valid 6-digit Indian PIN code.'});
  try{
    const r=await fetch(`https://api.postalpincode.in/pincode/${pin}`,{headers:{'Accept':'application/json'}});
    const data=await r.json();
    const root=data?.[0];
    if(!root || root.Status!=='Success' || !root.PostOffice?.length) return res.status(404).json({success:false,error:'PIN code not found.'});
    const po=root.PostOffice[0];
    res.json({success:true,pincode:pin,city:po.District||po.Block||'',state:po.State||'',country:po.Country||'India',area:po.Name||'',postOffices:root.PostOffice.map(x=>({name:x.Name,branchType:x.BranchType,district:x.District,state:x.State}))});
  }catch(e){res.status(502).json({success:false,error:'PIN lookup service is temporarily unavailable.'});}
});

app.get('/api/location/reverse', async (req,res)=>{
  const lat=Number(req.query.lat), lon=Number(req.query.lon);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<-90||lat>90||lon<-180||lon>180) return res.status(400).json({success:false,error:'Invalid coordinates.'});
  try{
    const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&addressdetails=1`,{headers:{'User-Agent':'Style-Heaven/1.0 (location lookup)'}});
    const data=await r.json(); const a=data?.address||{};
    res.json({success:true,latitude:lat,longitude:lon,displayName:data?.display_name||'',address:{area:a.suburb||a.neighbourhood||a.village||'',city:a.city||a.town||a.municipality||a.county||'',state:a.state||'',pin:a.postcode||'',country:a.country||'India'}});
  }catch(e){res.status(502).json({success:false,error:'Location lookup service is temporarily unavailable.'});}
});


app.post('/api/admin/orders/:orderId/status',(req,res)=>{const token=clean(req.headers['x-admin-token']);if(!process.env.ADMIN_TOKEN||token!==process.env.ADMIN_TOKEN)return res.status(403).json({success:false,error:'Admin access denied.'});const allowed=['placed','packed','shipped','delivered'];const status=clean(req.body.status).toLowerCase();if(!allowed.includes(status))return res.status(400).json({success:false,error:'Invalid order status.'});const info=db.prepare('UPDATE orders SET status=? WHERE order_id=?').run(status,req.params.orderId);if(!info.changes)return res.status(404).json({success:false,error:'Order not found.'});res.json({success:true,orderId:req.params.orderId,status});});

app.get('/api/health',(req,res)=>res.json({ok:true,service:'Style Heaven',database:'SQLite',timestamp:now()}));
app.listen(PORT,()=>console.log(`Style Heaven running at http://localhost:${PORT}`));
