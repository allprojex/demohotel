import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runServerOp } from "@/lib/server/errors.server";

/**
 * Trial / smoke-test data seeder.
 *
 * Every row we create is marked with either the `[TEST]` name prefix or the
 * `TEST-` SKU prefix so purgeTrialData can remove it deterministically without
 * schema changes. Restricted to admins of the selected property.
 */

const TEST_TAG = "[TEST]";
const SKU_PREFIX = "TEST-";

async function assertPropertyAdmin(supabase: any, userId: string, propertyId: string) {
  const { data, error } = await supabase.rpc("has_any_role", {
    _user_id: userId,
    _roles: ["super_admin", "hotel_owner", "general_manager"] as never,
    _property_id: propertyId,
  } as never);
  if (error) throw new Error(`has_any_role failed: ${error.message}`);
  if (!data) throw new Error("You need admin rights on this property.");
}

export const trialDataCounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { propertyId: string }) => {
    if (!d.propertyId) throw new Error("propertyId required");
    return d;
  })
  .handler(async ({ data, context }) =>
    runServerOp({ op: "trialData.counts", propertyId: data.propertyId }, async () => {
      const s = context.supabase as any;
      const [items, suppliers, outlets, orders, adjustments, notes] = await Promise.all([
        s.from("inventory_items").select("id", { count: "exact", head: true })
          .eq("property_id", data.propertyId).ilike("sku", `${SKU_PREFIX}%`),
        s.from("suppliers").select("id", { count: "exact", head: true })
          .eq("property_id", data.propertyId).ilike("name", `${TEST_TAG}%`),
        s.from("pos_outlets").select("id", { count: "exact", head: true })
          .eq("property_id", data.propertyId).ilike("name", `${TEST_TAG}%`),
        s.from("pos_orders").select("id", { count: "exact", head: true })
          .eq("property_id", data.propertyId).ilike("guest_name", `${TEST_TAG}%`),
        s.from("stock_adjustments").select("id", { count: "exact", head: true })
          .eq("property_id", data.propertyId).ilike("reason", `${TEST_TAG}%`),
        s.from("notifications").select("id", { count: "exact", head: true })
          .eq("user_id", context.userId).ilike("title", `${TEST_TAG}%`),
      ]);
      return {
        items: items.count ?? 0,
        suppliers: suppliers.count ?? 0,
        outlets: outlets.count ?? 0,
        orders: orders.count ?? 0,
        adjustments: adjustments.count ?? 0,
        notifications: notes.count ?? 0,
      };
    }),
  );

export const seedTrialData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { propertyId: string }) => {
    if (!d.propertyId) throw new Error("propertyId required");
    return d;
  })
  .handler(async ({ data, context }) =>
    runServerOp({ op: "trialData.seed", propertyId: data.propertyId, userId: context.userId }, async () => {
      const s = context.supabase as any;
      await assertPropertyAdmin(s, context.userId, data.propertyId);

      // --- Stock location (reuse existing or create a TEST one) ---
      let { data: loc } = await s.from("stock_locations").select("id")
        .eq("property_id", data.propertyId).limit(1).maybeSingle();
      if (!loc) {
        const ins = await s.from("stock_locations").insert({
          property_id: data.propertyId, name: `${TEST_TAG} Main Store`, kind: "store",
        }).select("id").single();
        if (ins.error) throw new Error(`create location: ${ins.error.message}`);
        loc = ins.data;
      }
      const locationId = loc!.id;

      // --- 2 suppliers ---
      const suppliersPayload = [
        { property_id: data.propertyId, name: `${TEST_TAG} Supplier A`, contact_name: "Test Rep A", email: "supplierA@test.local", phone: "+000000001", active: true },
        { property_id: data.propertyId, name: `${TEST_TAG} Supplier B`, contact_name: "Test Rep B", email: "supplierB@test.local", phone: "+000000002", active: true },
      ];
      const supIns = await s.from("suppliers").insert(suppliersPayload).select("id");
      if (supIns.error) throw new Error(`suppliers: ${supIns.error.message}`);

      // --- 5 inventory items ---
      const itemsPayload = [
        { property_id: data.propertyId, sku: `${SKU_PREFIX}001`, name: `${TEST_TAG} Bottled Water 500ml`, unit: "each", cost: 2, sale_price: 5, reorder_level: 20, active: true },
        { property_id: data.propertyId, sku: `${SKU_PREFIX}002`, name: `${TEST_TAG} Local Beer`, unit: "each", cost: 8, sale_price: 15, reorder_level: 24, active: true },
        { property_id: data.propertyId, sku: `${SKU_PREFIX}003`, name: `${TEST_TAG} Coffee Sachet`, unit: "each", cost: 1, sale_price: 3, reorder_level: 50, active: true },
        { property_id: data.propertyId, sku: `${SKU_PREFIX}004`, name: `${TEST_TAG} Club Sandwich`, unit: "each", cost: 12, sale_price: 35, reorder_level: 10, active: true },
        { property_id: data.propertyId, sku: `${SKU_PREFIX}005`, name: `${TEST_TAG} Jollof Rice Plate`, unit: "each", cost: 15, sale_price: 45, reorder_level: 10, active: true },
      ];
      const itemsIns = await s.from("inventory_items").insert(itemsPayload).select("id, sku, sale_price");
      if (itemsIns.error) throw new Error(`items: ${itemsIns.error.message}`);
      const items = itemsIns.data as Array<{ id: string; sku: string; sale_price: number }>;

      // --- Stocking: +100 units each via stock_adjustment (receipt) ---
      const adjIns = await s.from("stock_adjustments").insert({
        property_id: data.propertyId, location_id: locationId,
        reason: `${TEST_TAG} Initial trial stocking`, notes: "Auto-generated by trial data seeder",
        adjusted_at: new Date().toISOString(),
      }).select("id").single();
      if (adjIns.error) throw new Error(`stock adj: ${adjIns.error.message}`);
      const linesIns = await s.from("stock_adjustment_lines").insert(
        items.map((i) => ({ adjustment_id: adjIns.data.id, item_id: i.id, delta: 100 })),
      );
      if (linesIns.error) throw new Error(`stock adj lines: ${linesIns.error.message}`);
      // Materialize item_stock rows so dashboards see quantities immediately.
      for (const i of items) {
        const up = await s.from("item_stock").upsert({
          property_id: data.propertyId, item_id: i.id, location_id: locationId, quantity: 100,
        }, { onConflict: "item_id,location_id" });
        if (up.error) throw new Error(`item_stock upsert: ${up.error.message}`);
      }

      // --- POS outlet + table ---
      const outIns = await s.from("pos_outlets").insert({
        property_id: data.propertyId, name: `${TEST_TAG} Trial Outlet`, kind: "restaurant", tax_rate: 0, active: true,
      }).select("id").single();
      if (outIns.error) throw new Error(`outlet: ${outIns.error.message}`);
      const outletId = outIns.data.id;

      const tblIns = await s.from("pos_tables").insert({
        property_id: data.propertyId, outlet_id: outletId, label: `${TEST_TAG} T1`, seats: 4,
      }).select("id").single();
      if (tblIns.error) throw new Error(`table: ${tblIns.error.message}`);

      // --- 3 POS sales: each closed with a payment ---
      const salePlans: Array<Array<{ i: number; qty: number }>> = [
        [{ i: 0, qty: 2 }, { i: 2, qty: 1 }],           // 2 water + 1 coffee
        [{ i: 1, qty: 3 }],                              // 3 beers
        [{ i: 3, qty: 1 }, { i: 4, qty: 1 }],           // sandwich + jollof
      ];
      let orderIds: string[] = [];
      for (let n = 0; n < salePlans.length; n++) {
        const ord = await s.from("pos_orders").insert({
          property_id: data.propertyId, outlet_id: outletId, table_id: tblIns.data.id,
          status: "open", guest_name: `${TEST_TAG} Walk-in ${n + 1}`,
        }).select("id").single();
        if (ord.error) throw new Error(`order ${n}: ${ord.error.message}`);
        const orderId = ord.data.id;
        orderIds.push(orderId);
        let subtotal = 0;
        const lines = salePlans[n].map((p) => {
          const it = items[p.i];
          subtotal += Number(it.sale_price) * p.qty;
          return { order_id: orderId, menu_item_id: null, name_snapshot: `${TEST_TAG} ${it.sku}`, price_snapshot: it.sale_price, quantity: p.qty };
        });
        const li = await s.from("pos_order_items").insert(lines);
        if (li.error) throw new Error(`order lines ${n}: ${li.error.message}`);
        // Reduce stock by sold quantities (single consolidated adjustment).
        const outAdj = await s.from("stock_adjustments").insert({
          property_id: data.propertyId, location_id: locationId,
          reason: `${TEST_TAG} POS sale ${n + 1}`,
          adjusted_at: new Date().toISOString(),
        }).select("id").single();
        if (outAdj.error) throw new Error(`sale adj ${n}: ${outAdj.error.message}`);
        const outLines = salePlans[n].map((p) => ({ adjustment_id: outAdj.data.id, item_id: items[p.i].id, delta: -p.qty }));
        const outLinesIns = await s.from("stock_adjustment_lines").insert(outLines);
        if (outLinesIns.error) throw new Error(`sale adj lines ${n}: ${outLinesIns.error.message}`);
        for (const p of salePlans[n]) {
          const cur = await s.from("item_stock").select("quantity")
            .eq("item_id", items[p.i].id).eq("location_id", locationId).maybeSingle();
          const newQty = Number(cur.data?.quantity ?? 0) - p.qty;
          await s.from("item_stock").upsert({
            property_id: data.propertyId, item_id: items[p.i].id, location_id: locationId, quantity: newQty,
          }, { onConflict: "item_id,location_id" });
        }
        // Close order + payment.
        const close = await s.from("pos_orders").update({
          status: "closed", subtotal, tax: 0, total: subtotal, closed_at: new Date().toISOString(),
        }).eq("id", orderId);
        if (close.error) throw new Error(`close ${n}: ${close.error.message}`);
        const pay = await s.from("pos_payments").insert({
          order_id: orderId, method: "cash", amount: subtotal, reference: `${TEST_TAG} sale ${n + 1}`,
        });
        if (pay.error) throw new Error(`payment ${n}: ${pay.error.message}`);
      }

      // --- Notification (personal, system scope) so bell verifies ---
      const notif = await s.from("notifications").insert({
        user_id: context.userId, property_id: null,
        category: "system", priority: "normal",
        title: `${TEST_TAG} Trial data seeded`,
        body: `Seeded ${items.length} items, ${suppliersPayload.length} suppliers, ${salePlans.length} POS sales.`,
        metadata: { trial: true, propertyId: data.propertyId },
      });
      if (notif.error) throw new Error(`notification: ${notif.error.message}`);

      return {
        items: items.length,
        suppliers: suppliersPayload.length,
        orders: orderIds.length,
        adjustments: 1 + salePlans.length,
        notifications: 1,
      };
    }),
  );

export const purgeTrialData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { propertyId: string }) => {
    if (!d.propertyId) throw new Error("propertyId required");
    return d;
  })
  .handler(async ({ data, context }) =>
    runServerOp({ op: "trialData.purge", propertyId: data.propertyId, userId: context.userId }, async () => {
      const s = context.supabase as any;
      await assertPropertyAdmin(s, context.userId, data.propertyId);

      // Orders first (cascade covers pos_order_items, pos_payments, pos_kots).
      const orders = await s.from("pos_orders").select("id")
        .eq("property_id", data.propertyId).ilike("guest_name", `${TEST_TAG}%`);
      if (orders.error) throw new Error(orders.error.message);
      const orderIds: string[] = (orders.data ?? []).map((o: any) => o.id);
      if (orderIds.length) {
        const d1 = await s.from("pos_orders").delete().in("id", orderIds);
        if (d1.error) throw new Error(`delete orders: ${d1.error.message}`);
      }
      // Tables + outlets (test-tagged only).
      await s.from("pos_tables").delete().eq("property_id", data.propertyId).ilike("label", `${TEST_TAG}%`);
      await s.from("pos_outlets").delete().eq("property_id", data.propertyId).ilike("name", `${TEST_TAG}%`);

      // Stock adjustments (cascade covers lines).
      const adjs = await s.from("stock_adjustments").select("id")
        .eq("property_id", data.propertyId).ilike("reason", `${TEST_TAG}%`);
      if (adjs.error) throw new Error(adjs.error.message);
      const adjIds = (adjs.data ?? []).map((a: any) => a.id);
      if (adjIds.length) {
        const d2 = await s.from("stock_adjustments").delete().in("id", adjIds);
        if (d2.error) throw new Error(`delete adjustments: ${d2.error.message}`);
      }

      // item_stock rows for TEST items get removed by inventory_items cascade,
      // but delete inventory_items last (FK RESTRICT on adjustment_lines is now clear).
      const items = await s.from("inventory_items").select("id")
        .eq("property_id", data.propertyId).ilike("sku", `${SKU_PREFIX}%`);
      const itemIds = (items.data ?? []).map((i: any) => i.id);
      if (itemIds.length) {
        const dItems = await s.from("inventory_items").delete().in("id", itemIds);
        if (dItems.error) throw new Error(`delete items: ${dItems.error.message}`);
      }

      // Suppliers.
      await s.from("suppliers").delete()
        .eq("property_id", data.propertyId).ilike("name", `${TEST_TAG}%`);

      // Notifications (own only).
      await s.from("notifications").delete()
        .eq("user_id", context.userId).ilike("title", `${TEST_TAG}%`);

      // TEST location (only if we created it and it's no longer referenced).
      const testLocs = await s.from("stock_locations").select("id")
        .eq("property_id", data.propertyId).ilike("name", `${TEST_TAG}%`);
      for (const l of testLocs.data ?? []) {
        await s.from("stock_locations").delete().eq("id", l.id); // ignore FK errors if still in use
      }

      return { ok: true };
    }),
  );
