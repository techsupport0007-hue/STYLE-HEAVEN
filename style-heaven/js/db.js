const DB={
  read(key,fallback){try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback}catch{return fallback}},
  write(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch(e){console.error(e)}}
};
const SHIPPING_FEE=100,FREE_SHIPPING_MIN=2500;
const api=async(url,options={})=>{const token=localStorage.getItem('sh_token');const headers={'Content-Type':'application/json',...(options.headers||{})};if(token)headers.Authorization=`Bearer ${token}`;const r=await fetch(url,{...options,headers});let data={};try{data=await r.json()}catch{}if(r.status===401){localStorage.removeItem('sh_token');localStorage.removeItem('sh_user');}if(!r.ok)throw new Error(data.error||'Something went wrong.');return data};
const fmtINR=n=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(n||0);
const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const productImg=(p,w=500)=>p?.image||'';
const productById=async id=>(await api(`/api/products/${encodeURIComponent(id)}`)).product;
function cartRead(){return DB.read('sh_cart',[])}
function cartWrite(v){DB.write('sh_cart',v);if(typeof renderNav==='function')renderNav()}
async function wishlistIds(){try{const d=await api('/api/wishlist');return new Set(d.products.map(p=>p.id))}catch{return new Set()}}
async function toggleWishlist(id,button){if(!localStorage.getItem('sh_token')){const redirect=encodeURIComponent(location.pathname+location.search);location.href=`login.html?redirect=${redirect}`;return;}try{const ids=await wishlistIds();if(ids.has(Number(id))){await api(`/api/wishlist/${id}`,{method:'DELETE'});if(button){button.classList.remove('active');button.textContent='♡ Wishlist'}}else{await api(`/api/wishlist/${id}`,{method:'POST'});if(button){button.classList.add('active');button.textContent='♥ Wishlisted'}}}catch(e){alert(e.message)}}
function requireLogin(){if(!localStorage.getItem('sh_token')){location.href=`login.html?redirect=${encodeURIComponent(location.pathname+location.search)}`;return false}return true}
