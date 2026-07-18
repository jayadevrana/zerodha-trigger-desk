import fs from "node:fs";
import path from "node:path";

const defaultRuntimeState = {
  session: null,
  triggers: [],
  orders: [],
  atoAlerts: [],
};

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(defaultRuntimeState));
}

export function createRuntimeStore(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  let state = loadState(filePath);

  function loadState(targetPath) {
    if (!fs.existsSync(targetPath)) {
      return cloneDefaultState();
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(targetPath, "utf8"));
      return {
        ...cloneDefaultState(),
        ...parsed,
        triggers: Array.isArray(parsed?.triggers) ? parsed.triggers : [],
        orders: Array.isArray(parsed?.orders) ? parsed.orders : [],
        atoAlerts: Array.isArray(parsed?.atoAlerts) ? parsed.atoAlerts : [],
      };
    } catch {
      return cloneDefaultState();
    }
  }

  function save() {
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  }

  return {
    getState() {
      return state;
    },
    updateSession(session) {
      state = {
        ...state,
        session,
      };
      save();
      return state.session;
    },
    updateTriggers(triggers) {
      state = {
        ...state,
        triggers,
      };
      save();
      return state.triggers;
    },
    updateOrders(orders) {
      state = {
        ...state,
        orders,
      };
      save();
      return state.orders;
    },
    updateAtoAlerts(atoAlerts) {
      state = {
        ...state,
        atoAlerts,
      };
      save();
      return state.atoAlerts;
    },
  };
}
