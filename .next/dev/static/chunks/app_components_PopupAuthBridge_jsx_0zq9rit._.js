(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/app/components/PopupAuthBridge.jsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>PopupAuthBridge
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var _s = __turbopack_context__.k.signature();
"use client";
;
function PopupAuthBridge() {
    _s();
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "PopupAuthBridge.useEffect": ()=>{
            const isPopup = window.name === "googleAuthPopup" && !!window.opener && !window.opener.closed;
            if (!isPopup) {
                return;
            }
            console.log("[auth-popup-bridge] Popup detected on /, checking session before auto-close.");
            let cancelled = false;
            const closeIfAuthenticated = {
                "PopupAuthBridge.useEffect.closeIfAuthenticated": async ()=>{
                    try {
                        const response = await fetch("/api/auth/session", {
                            method: "GET",
                            headers: {
                                Accept: "application/json"
                            },
                            cache: "no-store",
                            credentials: "include"
                        });
                        const contentType = response.headers.get("content-type") || "";
                        if (!response.ok || !contentType.includes("application/json")) {
                            console.log("[auth-popup-bridge] Session endpoint unavailable in popup.");
                            return;
                        }
                        const session = await response.json();
                        if (!session?.user || cancelled) {
                            return;
                        }
                        console.log("[auth-popup-bridge] Session confirmed. Posting auth-success and closing popup.");
                        try {
                            window.opener.postMessage({
                                type: "auth-success"
                            }, window.location.origin);
                        } catch (error) {
                            console.log("[auth-popup-bridge] Failed to post auth-success message:", error);
                        }
                        window.close();
                    } catch (error) {
                        console.log("[auth-popup-bridge] Session check failed:", error);
                    }
                }
            }["PopupAuthBridge.useEffect.closeIfAuthenticated"];
            closeIfAuthenticated();
            return ({
                "PopupAuthBridge.useEffect": ()=>{
                    cancelled = true;
                }
            })["PopupAuthBridge.useEffect"];
        }
    }["PopupAuthBridge.useEffect"], []);
    return null;
}
_s(PopupAuthBridge, "OD7bBpZva5O2jO+Puf00hKivP7c=");
_c = PopupAuthBridge;
var _c;
__turbopack_context__.k.register(_c, "PopupAuthBridge");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
]);

//# sourceMappingURL=app_components_PopupAuthBridge_jsx_0zq9rit._.js.map