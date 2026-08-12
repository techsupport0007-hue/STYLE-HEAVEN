// toast.js — shows a small "Added to bag" notification with
// View Bag / Buy Now actions after a product is added.

function ensureToastEl() {
  let el = document.getElementById('shToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'shToast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  return el;
}

let toastTimer = null;

function showAddedToast(product) {
  const el = ensureToastEl();
  el.innerHTML = `
    <img src="${productImg(product, 80, 100)}" alt="">
    <div class="toast-body">
      <div class="toast-title">Added to bag</div>
      <div class="toast-name">${product.name}</div>
      <div class="toast-actions">
        <a class="btn ghost" href="cart.html">View bag</a>
        <button class="btn blush" onclick="buyNow(${product.id})">Buy now</button>
      </div>
    </div>
    <button class="toast-close" onclick="hideToast()" aria-label="Close">&times;</button>
  `;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}

function hideToast() {
  const el = document.getElementById('shToast');
  if (el) el.classList.remove('show');
}

// Buy Now: item is already in the bag (added just before this is called) —
// jump straight to checkout instead of continuing to browse.
function buyNow(id) {
  window.location.href = 'checkout.html';
}
