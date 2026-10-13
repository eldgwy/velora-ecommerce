# VELORA — Returns Policy Decisions (for the product owner)

The code enforces one invariant: **issuing a refund never restocks inventory**
(`requestRefund` touches only `refunds`/`orders.paymentStatus`/audit; the
customer email states this explicitly). Everything below needs a product
decision before any returns module is built. No returns flow is implemented.

| # | Decision required | Code impact if yes |
|---|---|---|
| 1 | Are returns accepted at all? | If no: keep admin refunds as goodwill-only with reason codes; close the escalation path wording. |
| 2 | Eligible items and time window (e.g. 30 days, final-sale SKUs excluded)? | Eligibility check in the refund command; order age from `createdAt`. |
| 3 | Who authorizes a return (support role vs admin-only)? | `requireAdmin` covers ADMIN+STAFF today; a narrower role needs RBAC work. |
| 4 | Partial refunds allowed (current behavior: yes, capped at captured)? | Already supported; confirm or restrict to full-only. |
| 5 | Inspection required before restock? | Verified-return step calling existing `restockReturn` (creates `RETURN` movement); needs a return-state machine. |
| 6 | When does returned stock become sellable? | Immediately on inspection-pass vs quarantine window; affects availability math. |
| 7 | Damaged/unsellable items? | `damage()` path exists in inventory service — needs a return-disposition step to invoke it. |
| 8 | Are shipping fees refundable? | Prorate `shippingAmount` in the cap math (currently the cap is payment-total based). |
| 9 | Refund notifications/audit wording? | `refund_issued` template + `refund_issued`/`refund_reconciled` events exist; confirm copy and whether reconciled refunds should notify (currently silent). |

Until signed: refunds stay admin-initiated, reason-mandatory, money-only —
no stock movement, no customer self-service returns.
