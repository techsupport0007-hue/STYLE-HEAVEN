# Style Heaven — Production Storefront Build

Style Heaven is a responsive fashion storefront with a Node.js/Express backend, SQLite database database, customer authentication, email OTP, wishlist, order storage, COD and Razorpay payments.

## Requirements

- Node.js 22.5+ (the project uses Node's built-in SQLite database module)
- A Razorpay Test Mode account for online payments
- A Resend account/API key for email OTP and contact/merchant email delivery

## Run locally

```powershell
cd C:\path\to\style-heaven
npm.cmd install
```

Create:

```text
server/.env
```

Copy the values from `server/.env.example` and fill in your real keys/emails.

Then:

```powershell
npm.cmd start
```

Open:

```text
http://localhost:3000
```

Do not use VS Code Live Server for this build. The Node server serves both the website and the API routes.

## Database

SQLite database is stored at:

```text
server/style-heaven.db
```

The database is created automatically on first start.

Tables include users, products, wishlist, orders, order_items, OTP codes, sessions and enquiries.

## Email

The website uses server-side email delivery for:

- Signup verification OTP
- Email OTP login
- Forgot-password OTP
- Customer support messages
- Merchant enquiries
- New order notifications

Update these values in `server/.env` when your Style Heaven mailboxes are ready:

```env
FROM_EMAIL=Style Heaven <your-verified-sender@example.com>
CUSTOMER_SUPPORT_EMAIL=customer-support@example.com
MERCHANT_EMAIL=merchant-team@example.com
ORDER_EMAIL=orders@example.com
```

The email provider's free tier and limits can change, so do not treat any third-party free plan as a permanent guarantee.

## Payments

Razorpay uses Test Mode credentials on the server. The secret key is never placed in browser JavaScript.

COD is enabled and is stored as a separate payment mode in the orders table.

## Product catalogue

The seed catalogue contains a focused set of unique product images rather than repeating the same image across hundreds of artificial variants. Replace catalogue photography with actual supplier/brand-owned product photography before commercial launch.


## Production data storage
The application uses a server-side SQLite database for users, sessions, products, wishlists, orders, OTPs and enquiries. A database cannot safely provide authenticated multi-user storage from browser-only JavaScript; keep the Node/Express server running in development and deploy it with persistent storage in production.

## Production location & merchant flow

### Address auto-fill
- Customers can enter an Indian 6-digit PIN and the checkout/profile automatically looks up city/state/area.
- Customers can also use browser geolocation. The browser asks for permission; the server reverse-geocodes coordinates and fills available city/state/PIN details.
- Customers can always edit the detected address before saving or placing an order.
- For a commercial launch, configure a production geocoding provider (for example Google Maps Platform) instead of relying on public geocoding infrastructure at scale.

### Merchant onboarding rules
Style Heaven's B2B onboarding should verify business identity, contact details, GST information where applicable, category fit, product authenticity, catalogue rights, fulfilment capability and commercial terms. Merchants must only supply/list products they are authorised to sell, must not upload counterfeit or misleading catalogue content, and must keep product information and fulfilment commitments accurate. Style Heaven may pause or reject applications where verification, quality, compliance or operational requirements are not met.

### Merchant operating model
1. Merchant submits business application.
2. Style Heaven reviews business and category fit.
3. Documents and commercial requirements are verified.
4. Merchant agreement / commercial terms are finalised.
5. Approved merchant receives business access.
6. Merchant can use the B2B workflow for catalogue, orders, support and settlement discussions.

### Verified reviews
The project does not manufacture customer reviews. A customer can submit a verified review only after a delivered order containing the product. The database stores the review against the customer, order and product.

### Admin order status testing
Set `ADMIN_TOKEN` in `server/.env`. For local workflow testing, an administrator can move an order through `placed`, `packed`, `shipped`, and `delivered` using the protected admin API. In a full production deployment, replace the token-only admin route with a proper admin identity, role and audit system.
