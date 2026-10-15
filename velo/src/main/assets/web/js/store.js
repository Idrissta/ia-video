/* Vélo Champion — boutique : achat des vélos.
 *
 * - Application installée depuis Google Play : paiement réel via Google Play
 *   Billing (pont natif VeloNative.store*).
 * - Version de test (APK « TEST ») et navigateur : achats simulés, pour essayer
 *   tous les niveaux avant la publication.
 */
(function (root) {
  'use strict';
  const VC = root.VC;
  const native = () => root.VeloNative;

  const Store = VC.Store = {
    mode: 'web',          // 'play' | 'test' | 'web'
    ready: false,
    available: false,
    prices: {},
    pending: null,
    listeners: [],

    init() {
      const n = native();
      if (n && n.storeMode) {
        this.mode = n.storeMode();
        if (this.mode === 'play') {
          root.veloStoreEvent = (json) => this.onNative(typeof json === 'string' ? JSON.parse(json) : json);
          const ids = VC.BIKES.filter((b) => b.product).map((b) => b.product);
          n.storeConnect(JSON.stringify(ids));
          return;
        }
      } else {
        this.mode = 'web';
      }
      this.ready = true;
      this.available = true;
    },

    on(fn) {
      this.listeners.push(fn);
    },
    notify(evt) {
      for (const fn of this.listeners) {
        try {
          fn(evt);
        } catch (e) {
          // un écran fermé ne doit pas bloquer les autres
        }
      }
    },

    priceOf(bike) {
      if (!bike.product) return bike.price;
      return this.prices[bike.product] || bike.price;
    },

    onNative(evt) {
      switch (evt.type) {
        case 'ready':
          this.ready = true;
          this.available = !!evt.available;
          break;
        case 'products':
          for (const p of evt.items || []) this.prices[p.id] = p.price;
          break;
        case 'owned':
          VC.Save.setPurchased(evt.ids || []);
          break;
        case 'purchase':
          if (evt.state === 'purchased') {
            const bike = VC.BIKES.find((b) => b.product === evt.id);
            if (bike) VC.Save.own(bike.id);
          }
          if (this.pending) {
            const done = this.pending;
            this.pending = null;
            done(evt);
          }
          break;
      }
      this.notify(evt);
    },

    /**
     * Lance l'achat d'un vélo. Résout avec { state: 'purchased' | 'pending' |
     * 'cancelled' | 'unavailable' | 'error', message? }.
     */
    buy(bike) {
      return new Promise((resolve) => {
        if (!bike.product) return resolve({ state: 'purchased' });
        if (this.mode === 'play') {
          if (!this.available) return resolve({ state: 'unavailable' });
          if (this.pending) return resolve({ state: 'busy' });
          this.pending = resolve;
          native().storeBuy(bike.product);
          return;
        }
        // Achat simulé (version de test / navigateur).
        VC.Save.own(bike.id);
        resolve({ state: 'purchased', simulated: true });
        this.notify({ type: 'purchase', id: bike.product, state: 'purchased' });
      });
    },

    restore() {
      if (this.mode === 'play' && native()) native().storeRestore();
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
