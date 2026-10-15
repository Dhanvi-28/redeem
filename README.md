# RevoGreen Digital Twin

A standalone, browser-based interactive demo based on `EcoSync_Project_Idea_Overview.md`. It demonstrates the attached waste-deposit and product-vending units as one connected system.

## Run it

**Quickest:** double-click `index.html` and open it in a modern browser. No install, account, API key, database, or build step is needed.

**Optional local server:** from this folder run:

```powershell
py -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000). If `py` is unavailable, use `python -m http.server 8000`. Stop the server with Ctrl+C.

## Try the interactive flow

1. Choose PET bottle, aluminium can, or paper/cardboard and enter a weight in grams (1–5,000).
2. Select **Start deposit simulation** and watch the identity, classification, measurement, and sorting stages update on both machine screens.
3. Select **Save to wallet** to credit the demo wallet, or **Redeem now** to pick a product. Product cost is checked against the wallet plus the pending deposit; successful demo redemption deducts points and updates simulated stock.
4. Explore **Full system**, **Waste unit**, and **Vending** views. Use **Reset** to restore the original balance, ledger, and product stock.

## What is simulated

All readings and events are local browser demo state. The QR is a masked example identity, classification uses the chosen demo category, weight is manually entered, reward rates are illustrative, and machine connectivity / inventory / dispensing are not connected to real hardware or a backend. The page does not award value outside this demo.

Reward rates used in the demo are 0.08 points/gram for PET, 0.12 for aluminium, and 0.04 for paper, rounded down to whole points (with a 1-point minimum for a valid sample). Change them in the `rates` object in the page script if you need different presentation values.

## Project files

- `index.html` — complete responsive UI, styling, and interactive simulation in one file.
- `EcoSync_Project_Idea_Overview.md` — source project brief.

This demo is intentionally separate from the existing citizen website and CV: the supplied folder contained the project brief only, so no existing website files were available to integrate here.
