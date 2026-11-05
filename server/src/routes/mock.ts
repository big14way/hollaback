import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";
import type { MockPayPal } from "../paypal/mock.js";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
:root{--bg:#f4f6f9;--card:#fff;--ink:#1b2430;--muted:#5b6675;--line:#dde3ea;--accent:#1f4fd1;--ok:#0f7b4a}
@media (prefers-color-scheme:dark){:root{--bg:#0f141a;--card:#18202a;--ink:#e8edf3;--muted:#9aa6b4;--line:#2a3542;--accent:#6c95ff;--ok:#38c98a}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink);display:grid;place-items:center;min-height:100vh;padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;max-width:420px;width:100%;padding:24px}
.tag{display:inline-block;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);border:1px dashed var(--line);border-radius:999px;padding:2px 10px;margin-bottom:12px}
h1{font-size:20px;margin:0 0 4px}p{color:var(--muted);margin:0 0 16px}
table{width:100%;border-collapse:collapse;margin:8px 0 16px}td{padding:6px 0;border-bottom:1px solid var(--line)}td:last-child{text-align:right}
.total td{font-weight:600;border-bottom:0}
button{width:100%;font:inherit;font-weight:600;padding:12px;border-radius:10px;border:1px solid var(--line);cursor:pointer;margin-top:8px;background:transparent;color:var(--ink)}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.done{color:var(--ok);font-weight:600}
</style></head><body><main class="card">${body}</main></body></html>`;
}

/**
 * Pages that stand in for PayPal's hosted approval and invoice screens when
 * MOCK_PAYPAL=1. They are clearly labelled as simulated.
 */
export function registerMockRoutes(app: FastifyInstance, _deps: AppDeps, mock: MockPayPal): void {
  app.get<{ Querystring: { token?: string } }>("/mock/paypal/checkoutnow", async (req, reply) => {
    const order = req.query.token ? mock.orders.get(req.query.token) : undefined;
    if (!order) return reply.code(404).type("text/html").send(page("Order not found", "<h1>Order not found</h1>"));
    const unit = order.purchase_units?.[0];
    const rows = (unit?.items ?? [])
      .map((i) => `<tr><td>${esc(i.quantity)} × ${esc(i.name)}</td><td>${esc(i.unit_amount.value)} ${esc(i.unit_amount.currency_code)}</td></tr>`)
      .join("");
    const discount = unit?.amount.breakdown?.discount
      ? `<tr><td>Discount</td><td>−${esc(unit.amount.breakdown.discount.value)}</td></tr>`
      : "";
    const body = `<span class="tag">Simulated PayPal approval · MOCK_PAYPAL=1</span>
<h1>Review your payment</h1><p>Order ${esc(order.id)} · status ${esc(order.status)}</p>
<table>${rows}${discount}<tr class="total"><td>Total</td><td>${esc(unit?.amount.value)} ${esc(unit?.amount.currency_code)}</td></tr></table>
<div id="msg"></div>
<button class="primary" id="approve">Pay now (approve)</button>
<button id="paylater">Pay in 4 with Pay Later (approve)</button>
<button id="cancel">Cancel and return to store</button>
<script>
const id=${JSON.stringify(order.id)};
async function act(kind){
  const r=await fetch('/mock/paypal/orders/'+id+'/'+(kind==='cancel'?'cancel':'approve'),{method:'POST'});
  const d=await r.json();
  if(window.opener){try{window.opener.postMessage({source:'hollaback-mock-paypal',action:kind==='cancel'?'cancel':'approve',orderId:id},'*')}catch(e){}window.close();return}
  const next=kind==='cancel'?d.cancelUrl:d.returnUrl;
  if(next){location.href=next}else{document.getElementById('msg').innerHTML='<p class="done">'+(kind==='cancel'?'Cancelled.':'Approved. You can close this tab.')+'</p>'}
}
document.getElementById('approve').onclick=()=>act('approve');
document.getElementById('paylater').onclick=()=>act('approve');
document.getElementById('cancel').onclick=()=>act('cancel');
</script>`;
    return reply.type("text/html").send(page("PayPal (simulated)", body));
  });

  app.post<{ Params: { id: string } }>("/mock/paypal/orders/:id/approve", async (req, reply) => {
    if (!mock.orders.has(req.params.id)) return reply.code(404).send({ ok: false, error: "order not found" });
    const { order, returnUrl } = await mock.approveOrder(req.params.id);
    return { ok: true, status: order.status, returnUrl: returnUrl ?? null };
  });

  app.post<{ Params: { id: string } }>("/mock/paypal/orders/:id/cancel", async (req, reply) => {
    if (!mock.orders.has(req.params.id)) return reply.code(404).send({ ok: false, error: "order not found" });
    return { ok: true, cancelUrl: mock.cancelUrl(req.params.id) ?? null };
  });

  app.get<{ Querystring: { id?: string } }>("/mock/paypal/invoice", async (req, reply) => {
    const inv = req.query.id ? mock.invoices.get(req.query.id) : undefined;
    if (!inv) return reply.code(404).type("text/html").send(page("Invoice not found", "<h1>Invoice not found</h1>"));
    const rows = (inv.items ?? [])
      .map((i) => `<tr><td>${esc(i.quantity)} × ${esc(i.name)}</td><td>${esc(i.unit_amount.value)} ${esc(i.unit_amount.currency_code)}</td></tr>`)
      .join("");
    const body = `<span class="tag">Simulated PayPal invoice · MOCK_PAYPAL=1</span>
<h1>Invoice ${esc(inv.detail.invoice_number)}</h1><p>${esc(inv.detail.note ?? "")}</p>
<table>${rows}<tr class="total"><td>Total</td><td>${esc(inv.amount?.value)} ${esc(inv.amount?.currency_code)}</td></tr></table>
<p id="status">Status: ${esc(inv.status)}</p>
<button class="primary" id="pay" ${inv.status === "PAID" ? "disabled" : ""}>Pay invoice</button>
<script>
document.getElementById('pay').onclick=async()=>{
  const r=await fetch('/mock/paypal/invoices/${esc(inv.id)}/pay',{method:'POST'});const d=await r.json();
  document.getElementById('status').innerHTML='<span class="done">Status: '+d.status+'</span>';document.getElementById('pay').disabled=true;
};
</script>`;
    return reply.type("text/html").send(page("PayPal invoice (simulated)", body));
  });

  app.post<{ Params: { id: string } }>("/mock/paypal/invoices/:id/pay", async (req, reply) => {
    if (!mock.invoices.has(req.params.id)) return reply.code(404).send({ ok: false, error: "invoice not found" });
    const inv = await mock.payInvoice(req.params.id);
    return { ok: true, status: inv.status };
  });
}
