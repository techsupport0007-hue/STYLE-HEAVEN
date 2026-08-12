# Style Heaven — Location & Address Flow

## Customer experience

1. Customer signs in and opens Checkout or Profile.
2. Customer enters a 6-digit Indian PIN.
3. Style Heaven calls `/api/location/pincode/:pin`.
4. City, state and post-office/area are filled when available.
5. Customer can click **Use my current location**.
6. Browser permission is requested through the Geolocation API.
7. Latitude/longitude are reverse-geocoded and the address fields are filled where data is available.
8. Customer reviews and edits the final address before saving or placing the order.

## Important production note
Location is optional. The website must never force a customer to grant browser location permission. PIN lookup and manual entry remain available.

For a commercial deployment with meaningful traffic, use a production geocoding provider and review its pricing, API-key restrictions, data-retention terms and India coverage. The current implementation provides a working development flow and keeps the provider call behind the server where it can later be replaced.
