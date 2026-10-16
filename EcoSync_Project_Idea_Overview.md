# revogreen — Project Overview

## 1. Project Summary

**RevoGreen** is an AI-powered smart recycling and rewards ecosystem built around two attached vending units, a citizen website, an AI waste-classification model, a digital rewards system, and a digital twin visualization.

The first unit is a **smart waste-deposit machine** with a screen. It identifies the citizen through a permanent personal QR code or RFID card, accepts eligible waste, uses a camera and weight sensor to assess the deposit, and displays the detected category, measured weight, and reward points. The screen then lets the user choose to redeem points immediately through the attached product vending unit or keep the points in their account for later.

The second unit is a **product vending machine** stocked with items such as instant noodles, packaged snacks, and other configured products. When the citizen chooses to redeem, the product unit is activated and allows an eligible reward purchase based on the user's available points and the configured reward catalogue. If the citizen chooses not to redeem, the points remain in their EcoSync account.

The website links the physical machine to the citizen's account, so users can view their QR identity, wallet, deposit history, and rewards.

## 2. Problem

Recycling participation can be low when people lack clear disposal guidance or immediate incentives. Waste also needs to be identified and segregated correctly, while deposits, weights, reward points, and machine status must be tracked reliably. EcoSync connects AI-assisted waste classification, weight-based rewards, immediate redemption, an online wallet, and machine records into one ecosystem.

## 3. The Two-Unit Vending Machine

### Unit A — Smart Waste-Deposit Machine

This is the waste-dumping and reward-calculation unit. It includes:

- **Screen:** guides the citizen through identification, deposit, result, and redemption choice.
- **QR scanner or RFID reader:** identifies the citizen's EcoSync account.
- **Deposit/scanning plate:** holds the waste item for inspection.
- **Shaking mechanism:** spreads or levels the item before the final image is captured.
- **Camera with flash:** captures a well-lit image after the plate settles.
- **AI image-classification model:** predicts the supported waste category.
- **Pressure/weight sensor:** measures the stable weight of the deposit.
- **Controller:** coordinates the camera, sensor, screen, and sorting mechanism.
- **Sorting mechanism:** a flap, diverter, or other actuator directs accepted waste to the correct compartment.
- **Separate compartments:** store the accepted waste categories.

After a valid deposit, the screen displays the detected category, measured weight, and reward points. The user chooses one of two options:

1. **Redeem now:** proceed to the attached product vending unit and use eligible points for a product.
2. **Save to account:** keep the points in the user's EcoSync wallet for future redemption through the website or a later machine visit.

### Unit B — Product Vending Machine

This attached unit dispenses configured products, such as instant noodles, packaged food, snacks, and other items available in the reward catalogue.

When the user selects “Redeem now” on the waste-deposit unit:

- The system checks the user's available points and the current product catalogue.
- The product unit is activated for the eligible redemption flow.
- The user selects an available product within their points balance.
- The backend records the redemption and deducts the correct points.
- The product is dispensed only when the machine confirms a successful, authorized redemption, where the hardware supports this confirmation.

If the user chooses “Save to account,” no immediate product redemption occurs. The points are credited to their wallet and remain available for later redemption.

The two units should behave as one connected system, with shared user identity, reward rules, inventory state, and transaction records.

## 4. AI Image Classification and Scan & Reimagine

The camera image is classified into categories supported by the model and the physical machine, such as plastic/PET bottle or aluminium can. The system should display a confidence value only when the model provides a meaningful one.

The website can also provide a **Scan & Reimagine** feature. Citizens upload or capture an image to receive a likely category, reuse ideas, recycling instructions, and disposal guidance. This informational scan is separate from a verified machine deposit and never awards points.

AI classification identifies a likely category; it does not physically sort waste. Actual segregation requires a mechanical sorting mechanism.

## 5. Weight-Based Reward Calculation

After classification, the machine waits for the plate and sensor reading to stabilize. The backend validates the category, measured weight, accepted-item rules, and deposit event before calculating rewards.

**Reward points = accepted weight × reward rate for the accepted category**

Rates and rounding rules are configurable project settings, not official municipal rates. Weight alone does not establish recyclability. Unsupported categories, uncertain classifications, invalid measurements, and failed deposits must not earn points.

A unique deposit transaction should be created for each accepted deposit so retries cannot award points twice.

## 6. Citizen Website

The website provides:

- Registration, login, and logout.
- A permanent personal EcoSync QR identity.
- Home dashboard with points balance and recent activity.
- AI waste scanner and recycling guidance.
- Wallet and transaction history.
- Deposit history with category, measured weight, points, time, and machine where available.
- Rewards store/catalogue.
- Points redemption history.
- Profile and account settings.
- Optional machine locator and status page if actual location data is configured.

### Permanent QR Identity

A unique QR is generated when a user registers and remains linked to that same account. The QR is intended to identify the user at the **waste-deposit machine**; it is not a substitute for website login. An RFID card can be associated with the same account.

The QR should contain an opaque, unpredictable identifier—not the user's name, email, password, or sequential database ID. The backend must enforce a unique association so it cannot be assigned to another account. Because QR codes can be copied, the machine/backend should validate the QR and deposit session and use additional safeguards where practical to prevent someone from claiming rewards for another user's account.

## 7. Wallet and Rewards

The wallet shows available points, total points earned, deposits, immediate redemptions, later redemptions, and transaction history.

The redemption system supports two paths:

- **Immediate redemption at the attached product unit:** after a deposit, the user chooses to redeem now and selects an available product using eligible points.
- **Save for later:** points remain in the user's account and can be redeemed later through the website or a future machine visit.

The backend validates the balance and product availability and records point deductions in an auditable ledger. It must prevent negative balances, duplicate redemption, and dispensing a product without a valid redemption. Physical dispensing and inventory confirmation should only be claimed if the machine hardware actually supports them.

## 8. Digital Twin Visualization

A digital twin video explains the waste problem, the attached machine units, QR/RFID identification, deposit plate, camera, AI classification, weight measurement, sorting, reward display, and product redemption. It can also show how deposited waste enters separate compartments and how the wider waste-management system may monitor collection.

A connected digital twin interface can show machine status, deposit events, compartment fill levels, and alerts when relevant data is available. A pre-rendered video is an explanatory visualization, not automatically a live digital twin; a live twin must receive actual machine events or clearly labelled simulation events and update its state.

## 9. Admin and Operations Dashboard

Authorized operators can review:

- Status of the waste-deposit and product vending units.
- Recent deposits, category predictions, and weight readings.
- Points issued and points redeemed.
- Product inventory and successful/failed dispensing events, if available.
- Compartment capacity and collection alerts, if measured or configured.
- Machine errors and operational events.
- Waste and reward analytics.

The dashboard must not present invented sensor values, machine connectivity, inventory, or collection activity as real.

## 10. End-to-End Workflow

1. A citizen scans their permanent QR or taps their associated RFID card at the waste-deposit unit.
2. The machine identifies the account and begins a deposit session.
3. The user places eligible waste on the scanning plate.
4. The plate shakes/levels the waste, then settles.
5. The camera and flash capture the item.
6. The AI model predicts the waste category.
7. The pressure sensor records stable weight.
8. The system validates category, weight, and acceptance rules.
9. The sorting mechanism directs accepted waste to the appropriate compartment.
10. The screen displays category, weight, and points earned.
11. The user chooses **Redeem now** or **Save to account**.
12. If redeeming now, the attached product unit becomes available and the user selects an eligible product. The backend validates and records the redemption before dispensing.
13. If saving, points remain in the citizen's online wallet.
14. The website shows the updated balance, deposit history, and redemption history.
15. Machine and digital-twin status update when connected data is available.

A failed classification or invalid measurement must not earn points. A website photo scan is informational only and is not a machine deposit.

## 11. System Integration and Data

The website, AI service, waste-deposit unit, product unit, rewards system, and digital twin should use a shared backend and consistent data model.

Important records include:

- Users and account roles.
- Permanent QR identities and RFID-card associations.
- Waste-deposit and product vending units.
- Supported waste categories and compartments.
- Deposit sessions and unique deposit transactions.
- AI predictions and sensor readings.
- Wallet and reward transactions.
- Product catalogue, stock, and dispensing outcomes.
- Redemptions and their status.
- Machine status, alerts, and collection events.

A deposit and its points credit must be processed consistently and idempotently. Redemption must be authorized, deduct points exactly once, and be linked to a valid product/dispense outcome where applicable.

## 12. Proposed Technology Direction

- **Frontend:** React, Vite, TypeScript, and a consistent component system.
- **Backend:** Node.js/Express or FastAPI.
- **Database:** MongoDB for users, QR/RFID associations, deposits, wallet transactions, rewards, inventory, and machine events.
- **AI:** trained or pretrained computer-vision classification model.
- **Machine integration:** controller firmware plus an authenticated API or messaging interface.
- **QR:** generated QR containing an opaque permanent account identifier.
- **Visualization:** digital twin video and optionally a connected web dashboard/map.

Secrets must be stored in environment variables. Actual hardware readings, simulation events, and unavailable integrations must be clearly distinguished.

## 13. Security and Integrity

- Hash passwords securely.
- Never put personal details or passwords in the QR payload.
- Use unpredictable QR identifiers and unique database indexes.
- Keep each QR permanently bound to one account.
- Treat QR as machine identification, not website authentication.
- Validate deposits and redemptions on the server.
- Use authenticated machine/controller requests.
- Make deposit and redemption operations idempotent.
- Keep an auditable wallet ledger.
- Do not trust point totals, product prices, or inventory values submitted by the browser.
- Prevent dispensing without a valid authorized redemption.
- Keep machine and user credentials secret.

## 14. Project Deliverables

1. Physical smart waste-deposit vending unit with screen, QR/RFID identification, shaking plate, camera with flash, weight sensor, and sorting mechanism.
2. Attached product vending unit for configured packaged products.
3. AI image-classification model.
4. Citizen website with login, permanent QR, scanner, wallet, deposit history, and rewards redemption.
5. Backend APIs and MongoDB database.
6. Integration between machine events, user accounts, points, inventory, and redemption.
7. Digital twin video explaining the problem and solution.
8. Optional connected digital twin/admin dashboard reflecting real machine and transaction state.

## 15. Intended Impact

RevoGreen aims to encourage recycling through clear guidance and points, demonstrate image-based waste identification and physical segregation, provide both immediate and later rewards, and connect machine activity to a traceable digital account and wider waste-management view.

Real-world impact depends on classification accuracy, mechanical reliability, accepted waste streams, inventory and dispensing reliability, collection arrangements, and user participation.

## Project Summary

**RevoGreen is an AI-powered smart recycling ecosystem built around two attached vending units: a waste-deposit machine that identifies users by permanent QR/RFID, classifies waste, measures weight, and awards points; and a product vending machine that activates for eligible immediate redemption. Citizens can alternatively save their points to their online account and redeem them later through the website.** The website, MongoDB-backed rewards system, physical machine workflow, and digital twin visualization connect the recycling action to a traceable reward experience.
