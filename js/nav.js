async function renderNav(){
  const cart=DB.read('sh_cart',[]);const count=cart.reduce((s,c)=>s+c.qty,0);const countEl=document.getElementById('cartCount');if(countEl)countEl.textContent=count;
  const authEl=document.getElementById('authArea');if(!authEl)return;
  const token=localStorage.getItem('sh_token');
  if(!token){authEl.innerHTML='<div class="userchip"><a href="login.html">Log in</a> / <a href="signup.html">Sign up</a></div>';return;}
  let user=DB.read('sh_user',null);if(!user){try{user=(await api('/api/auth/me')).user;DB.write('sh_user',user)}catch{localStorage.removeItem('sh_token');authEl.innerHTML='<div class="userchip"><a href="login.html">Log in</a> / <a href="signup.html">Sign up</a></div>';return;}}
  authEl.innerHTML=`<div class="userchip"><a href="profile.html">Hi, ${escapeHtml(user.name.split(' ')[0])}</a><button onclick="logout()">Log out</button></div>`;
}
async function logout(){try{await api('/api/auth/logout',{method:'POST'})}catch{}localStorage.removeItem('sh_token');localStorage.removeItem('sh_user');location.href='index.html'}
function setupMobileNav(){const btn=document.getElementById('hamburgerBtn'),links=document.getElementById('navLinks');if(!btn||!links)return;btn.addEventListener('click',()=>{const open=links.classList.toggle('open');btn.classList.toggle('open',open);btn.setAttribute('aria-expanded',open?'true':'false')});links.querySelectorAll('a').forEach(a=>a.addEventListener('click',()=>{links.classList.remove('open');btn.classList.remove('open')}))}
document.addEventListener('DOMContentLoaded',()=>{renderNav();setupMobileNav()});
