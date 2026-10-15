package com.idrissta.velochampion;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Achats intégrés Google Play : un vélo = un produit à achat unique
 * (« produit intégré » non consommable dans la Play Console).
 * Chaque évènement est transmis à l'interface web sous forme JSON.
 */
final class Billing implements PurchasesUpdatedListener {

    interface Sink {
        void send(JSONObject event);
    }

    private final Activity activity;
    private final Sink sink;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, ProductDetails> details = new HashMap<>();
    private final List<String> productIds = new ArrayList<>();
    private BillingClient client;
    private boolean connecting;
    private int retries;
    private String lastProduct = "";

    Billing(Activity activity, Sink sink) {
        this.activity = activity;
        this.sink = sink;
    }

    /** Connexion au service Google Play puis lecture des prix et des achats. */
    void connect(List<String> ids) {
        productIds.clear();
        productIds.addAll(ids);
        if (client == null) {
            client = BillingClient.newBuilder(activity)
                    .setListener(this)
                    .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                    .build();
        }
        startConnection();
    }

    void end() {
        main.removeCallbacksAndMessages(null);
        if (client != null) client.endConnection();
        client = null;
    }

    private void startConnection() {
        if (client == null) return;
        if (client.isReady()) {
            onReady();
            return;
        }
        if (connecting) return;
        connecting = true;
        client.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult result) {
                connecting = false;
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                    retries = 0;
                    onReady();
                } else {
                    sendReady(false);
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                connecting = false;
                if (retries < 4) {
                    retries++;
                    main.postDelayed(Billing.this::startConnection, 1500L * retries);
                }
            }
        });
    }

    private void onReady() {
        queryProducts();
        queryPurchases();
    }

    private void queryProducts() {
        List<QueryProductDetailsParams.Product> list = new ArrayList<>();
        for (String id : productIds) {
            list.add(QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(id)
                    .setProductType(BillingClient.ProductType.INAPP)
                    .build());
        }
        if (list.isEmpty()) {
            sendReady(false);
            return;
        }
        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder().setProductList(list).build();
        client.queryProductDetailsAsync(params, (result, found) -> {
            JSONArray items = new JSONArray();
            if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                for (ProductDetails pd : found.getProductDetailsList()) {
                    details.put(pd.getProductId(), pd);
                    ProductDetails.OneTimePurchaseOfferDetails offer = pd.getOneTimePurchaseOfferDetails();
                    try {
                        items.put(new JSONObject()
                                .put("id", pd.getProductId())
                                .put("price", offer != null ? offer.getFormattedPrice() : ""));
                    } catch (JSONException ignored) {
                        // produit ignoré
                    }
                }
            }
            main.post(() -> {
                send(event("products").putItems(items));
                sendReady(!details.isEmpty());
            });
        });
    }

    /** Achats déjà effectués : restauration après réinstallation, remboursements. */
    void queryPurchases() {
        if (client == null || !client.isReady()) {
            startConnection();
            return;
        }
        QueryPurchasesParams params = QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.INAPP)
                .build();
        client.queryPurchasesAsync(params, (result, purchases) -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) return;
            JSONArray ids = new JSONArray();
            for (Purchase p : purchases) {
                if (p.getPurchaseState() != Purchase.PurchaseState.PURCHASED) continue;
                for (String id : p.getProducts()) ids.put(id);
                acknowledge(p);
            }
            main.post(() -> send(event("owned").putIds(ids)));
        });
    }

    void buy(String productId) {
        lastProduct = productId;
        ProductDetails pd = details.get(productId);
        if (client == null || !client.isReady() || pd == null) {
            sendPurchase(productId, "unavailable", "");
            startConnection();
            return;
        }
        BillingFlowParams.ProductDetailsParams item = BillingFlowParams.ProductDetailsParams.newBuilder()
                .setProductDetails(pd)
                .build();
        BillingFlowParams params = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(Collections.singletonList(item))
                .build();
        BillingResult r = client.launchBillingFlow(activity, params);
        int code = r.getResponseCode();
        if (code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
            sendPurchase(productId, "purchased", "");
            queryPurchases();
        } else if (code != BillingClient.BillingResponseCode.OK) {
            sendPurchase(productId, code == BillingClient.BillingResponseCode.USER_CANCELED ? "cancelled" : "error", r.getDebugMessage());
        }
    }

    @Override
    public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        int code = result.getResponseCode();
        if (code == BillingClient.BillingResponseCode.OK && purchases != null) {
            for (Purchase p : purchases) handle(p);
        } else if (code == BillingClient.BillingResponseCode.USER_CANCELED) {
            sendPurchase(lastProduct, "cancelled", "");
        } else if (code == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
            sendPurchase(lastProduct, "purchased", "");
            queryPurchases();
        } else {
            sendPurchase(lastProduct, "error", result.getDebugMessage());
        }
    }

    private void handle(Purchase p) {
        int state = p.getPurchaseState();
        for (String id : p.getProducts()) {
            if (state == Purchase.PurchaseState.PURCHASED) sendPurchase(id, "purchased", "");
            else if (state == Purchase.PurchaseState.PENDING) sendPurchase(id, "pending", "");
        }
        if (state == Purchase.PurchaseState.PURCHASED) acknowledge(p);
    }

    /** Un achat non confirmé sous 3 jours est remboursé automatiquement par Google Play. */
    private void acknowledge(Purchase p) {
        if (p.isAcknowledged() || client == null) return;
        AcknowledgePurchaseParams params = AcknowledgePurchaseParams.newBuilder()
                .setPurchaseToken(p.getPurchaseToken())
                .build();
        client.acknowledgePurchase(params, r -> {
            // En cas d'échec, l'achat sera de nouveau confirmé au prochain lancement.
        });
    }

    /* ------------------------------------------------------------------ */

    private void sendReady(boolean available) {
        send(event("ready").putFlag("available", available));
    }

    private void sendPurchase(String id, String state, String message) {
        send(event("purchase").putText("id", id).putText("state", state).putText("message", message == null ? "" : message));
    }

    private void send(Event e) {
        main.post(() -> sink.send(e.json));
    }

    private static Event event(String type) {
        return new Event(type);
    }

    /** Petit utilitaire pour construire les évènements sans try/catch partout. */
    private static final class Event {
        final JSONObject json = new JSONObject();

        Event(String type) {
            putText("type", type);
        }

        Event putText(String k, String v) {
            try {
                json.put(k, v);
            } catch (JSONException ignored) {
                // clé non nulle : n'arrive pas
            }
            return this;
        }

        Event putFlag(String k, boolean v) {
            try {
                json.put(k, v);
            } catch (JSONException ignored) {
                // clé non nulle : n'arrive pas
            }
            return this;
        }

        Event putItems(JSONArray items) {
            try {
                json.put("items", items);
            } catch (JSONException ignored) {
                // clé non nulle : n'arrive pas
            }
            return this;
        }

        Event putIds(JSONArray ids) {
            try {
                json.put("ids", ids);
            } catch (JSONException ignored) {
                // clé non nulle : n'arrive pas
            }
            return this;
        }
    }
}
