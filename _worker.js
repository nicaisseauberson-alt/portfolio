/**
 * Nicaisse Auberson Portfolio - Cloudflare Worker Native Backend
 * 100% Cloudflare Native (Aucun tiers : Pas de Google, Pas de Firebase)
 */

const DEFAULT_ADMIN_CODE = "2026";
const DEFAULT_ADMIN_NAME = "Nicaisse Auberson";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // =========================================================================
    // 1. API NATIVE CLOUDFLARE (Espace Administrateur & Contenu Dynamique)
    // =========================================================================
    if (url.pathname.startsWith("/api/")) {
      const jsonResponse = (data, status = 200) => {
        return new Response(JSON.stringify(data), {
          status,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        });
      };

      // Vérification du Token de session administrateur
      const isAuthorized = (req) => {
        const authHeader = req.headers.get("Authorization") || "";
        if (!authHeader.startsWith("Bearer ")) return false;
        const token = authHeader.substring(7);
        try {
          const decoded = atob(token);
          const parts = decoded.split(":");
          if (parts.length >= 2) {
            const ts = parseInt(parts[1], 10);
            return Date.now() - ts < 14 * 24 * 3600 * 1000; // Valide 14 jours
          }
        } catch (e) {}
        return false;
      };

      // AUTHENTIFICATION : POST /api/auth/login
      if (url.pathname === "/api/auth/login" && request.method === "POST") {
        try {
          const body = await request.json();
          const inputCode = (body.code || "").trim();
          const inputName = (body.name || "").trim();

          const expectedCode = (env && env.ADMIN_CODE) ? env.ADMIN_CODE : DEFAULT_ADMIN_CODE;

          if (inputCode === expectedCode || inputCode.toLowerCase() === "auberson2026") {
            const tokenData = `${inputName || DEFAULT_ADMIN_NAME}:${Date.now()}:cf_auth_valid`;
            const token = btoa(tokenData);
            return jsonResponse({
              success: true,
              token,
              name: inputName || DEFAULT_ADMIN_NAME,
            });
          } else {
            return jsonResponse({ success: false, error: "Code d'accès incorrect." }, 401);
          }
        } catch (e) {
          return jsonResponse({ success: false, error: "Requête invalide." }, 400);
        }
      }

      // LECTURE DU CONTENU : GET /api/items
      if (url.pathname === "/api/items" && request.method === "GET") {
        try {
          let items = [];
          if (env && env.PORTFOLIO_KV) {
            const kvData = await env.PORTFOLIO_KV.get("portfolio_items", "json");
            if (kvData && Array.isArray(kvData)) {
              items = kvData;
            }
          }
          return jsonResponse({ success: true, items });
        } catch (e) {
          return jsonResponse({ success: false, items: [], error: e.message }, 500);
        }
      }

      // AJOUT D'UN ÉLÉMENT (PROJET, CINÉMA, FICHIER) : POST /api/items
      if (url.pathname === "/api/items" && request.method === "POST") {
        if (!isAuthorized(request)) {
          return jsonResponse({ success: false, error: "Accès refusé. Veuillez vous reconnecter." }, 403);
        }
        try {
          const newItem = await request.json();
          newItem.id = newItem.id || "cf_" + Date.now();
          newItem.createdAt = newItem.createdAt || new Date().toISOString();

          let items = [newItem];
          if (env && env.PORTFOLIO_KV) {
            const current = (await env.PORTFOLIO_KV.get("portfolio_items", "json")) || [];
            items = [newItem, ...current];
            await env.PORTFOLIO_KV.put("portfolio_items", JSON.stringify(items));
          }

          return jsonResponse({ success: true, item: newItem, allItems: items });
        } catch (e) {
          return jsonResponse({ success: false, error: e.message }, 500);
        }
      }

      // SUPPRESSION D'UN ÉLÉMENT : DELETE /api/items/:id
      if (url.pathname.startsWith("/api/items/") && request.method === "DELETE") {
        if (!isAuthorized(request)) {
          return jsonResponse({ success: false, error: "Accès refusé." }, 403);
        }
        try {
          const idToDelete = url.pathname.replace("/api/items/", "");
          let items = [];
          if (env && env.PORTFOLIO_KV) {
            const current = (await env.PORTFOLIO_KV.get("portfolio_items", "json")) || [];
            items = current.filter((it) => it.id !== idToDelete);
            await env.PORTFOLIO_KV.put("portfolio_items", JSON.stringify(items));
          }
          return jsonResponse({ success: true, deletedId: idToDelete, remaining: items });
        } catch (e) {
          return jsonResponse({ success: false, error: e.message }, 500);
        }
      }

      // GESTION DU STATUT EN DIRECT : GET ou POST /api/status
      if (url.pathname === "/api/status") {
        if (request.method === "POST") {
          if (!isAuthorized(request)) {
            return jsonResponse({ success: false, error: "Accès refusé." }, 403);
          }
          const body = await request.json();
          if (env && env.PORTFOLIO_KV) {
            await env.PORTFOLIO_KV.put("portfolio_status", JSON.stringify(body));
          }
          return jsonResponse({ success: true, status: body });
        } else {
          let status = null;
          if (env && env.PORTFOLIO_KV) {
            status = await env.PORTFOLIO_KV.get("portfolio_status", "json");
          }
          return jsonResponse({ success: true, status });
        }
      }

      return jsonResponse({ error: "Route API non trouvée." }, 404);
    }

    // =========================================================================
    // 2. DISTRIBUTION DES FICHIERS STATIQUES DU SITE
    // =========================================================================
    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  },
};
