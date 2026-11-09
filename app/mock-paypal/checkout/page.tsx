import { getPipeline } from "@/lib/runtime";
import { formatUsd } from "@/lib/money";

export const dynamic = "force-dynamic";

/** MOCK stand-in for the PayPal payer-action page (sandbox mode uses the real one). */
export default async function MockCheckout({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  const pipe = await getPipeline();
  if (pipe.adapter.mode !== "mock") {
    return <main><p>Mock checkout is disabled in sandbox mode.</p></main>;
  }
  let order;
  try {
    order = await pipe.adapter.getOrder(token);
  } catch {
    order = null;
  }
  return (
    <main className="checkout">
      <div className="card checkout-card">
        <div className="mock-banner">MOCK · simulated PayPal payer approval · no money moves</div>
        <h1>Review your payment</h1>
        {order ? (
          <>
            <div className="checkout-amount">{formatUsd(order.amountCents)} {order.currency}</div>
            <dl className="kv">
              <dt>Pay to</dt><dd className="mono">{order.payeeEmail}</dd>
              <dt>For</dt><dd>{order.description}</dd>
              <dt>Order</dt><dd className="mono">{order.id} · {order.status}</dd>
            </dl>
            {order.status === "PAYER_ACTION_REQUIRED" ? (
              <form method="post" action="/api/mock-paypal/approve" className="row">
                <input type="hidden" name="token" value={order.id} />
                <button name="decision" value="approve" type="submit">Pay Now (approve)</button>
                <button name="decision" value="cancel" type="submit" className="secondary">Cancel and return</button>
              </form>
            ) : (
              <p className="mono">Order is {order.status} — nothing to approve.</p>
            )}
          </>
        ) : (
          <p className="mono">Unknown order token.</p>
        )}
      </div>
    </main>
  );
}
