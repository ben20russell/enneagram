module.exports = [
"[project]/app/components/PopupAuthBridge.jsx [app-ssr] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>PopupAuthBridge
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)");
"use client";
;
function PopupAuthBridge() {
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$server$2f$route$2d$modules$2f$app$2d$page$2f$vendored$2f$ssr$2f$react$2e$js__$5b$app$2d$ssr$5d$__$28$ecmascript$29$__["useEffect"])(()=>{
        const isPopup = window.name === "googleAuthPopup" && !!window.opener && !window.opener.closed;
        if (!isPopup) {
            return;
        }
        console.log("[auth-popup-bridge] Popup detected on /, checking session before auto-close.");
        let cancelled = false;
        const closeIfAuthenticated = async ()=>{
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
        };
        closeIfAuthenticated();
        return ()=>{
            cancelled = true;
        };
    }, []);
    return null;
}
}),
];

//# sourceMappingURL=app_components_PopupAuthBridge_jsx_0k9x2mi._.js.map