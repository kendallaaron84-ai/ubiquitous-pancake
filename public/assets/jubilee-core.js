/**
 * KOBA-I JUBILEE WORKS: Universal Agnostic Rendering Engine
 * Refactored for robust React 18 concurrent mounting and error handling.
 */

(function() {
    console.log("[KOBA-I] Engine script initialized. Verifying execution context...");

    // ==========================================
    // 1. THE MEDIA PLAYER COMPONENT (The Bloom Overlay)
    // ==========================================
    const JubileePlayerApp = ({ assetId, studioKey, config, onClose }) => {
        const { useState, useEffect, createElement: e } = window.React;
        const [status, setStatus] = useState('loading'); // loading, ready, error
        const [errorMsg, setErrorMsg] = useState('');

        useEffect(() => {
            let isMounted = true;

            const fetchSaaSData = async () => {
                try {
                    console.log(`[KOBA-I Player] Fetching secure asset: ${assetId}`);
                    const response = await fetch(`${config.endpoints.publicProduct}?assetId=${assetId}`, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Studio-Key': studioKey
                        }
                    });

                    const data = await response.json();

                    if (!isMounted) return;

                    if (!response.ok || data.error) {
                        throw new Error(data.error || (response.status === 403 ? "Tenant Key Invalid" : "Asset Not Found"));
                    }
                    
                    window.kobaData = data;
                    setStatus('ready');

                    // 🚀 FIX: Match the ID rendered by JubileePlayerApp exactly
                    setTimeout(() => {
                        const root = document.getElementById('koba-bloom-player-mount');
                        if (!root) {
                            console.error("[KOBA-I Player] Fatal: Mount point 'koba-bloom-player-mount' missing from DOM.");
                            return;
                        }

                        if (window.initBloomAudio) {
                            console.log("[KOBA-I Player] Initializing standard audio engine.");
                            window.initBloomAudio(root, data);
                        } else if (window.initBloomPlayer) {
                             console.log("[KOBA-I Player] Initializing legacy audio engine.");
                             window.initBloomPlayer(root, data, 'full');
                        } else {
                            console.error("[KOBA-I Player] No audio engine (initBloomAudio/initBloomPlayer) found globally.");
                            setErrorMsg("Audio engine failed to load. Please refresh the page.");
                            setStatus('error');
                        }
                    }, 100);

                } catch (error) {
                    if (!isMounted) return;
                    console.error("[KOBA-I Player] Jubilee Cloud Error:", error);
                    setErrorMsg(error.message);
                    setStatus('error');
                }
            };

            fetchSaaSData();

            return () => { isMounted = false; };
        }, [assetId, studioKey]);

        if (status === 'loading') {
            return e('div', { style: { position: 'fixed', inset: 0, zIndex: 999999, background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'sans-serif' } }, 'Decrypting Secure Stream...');
        }

        if (status === 'error') {
            return e('div', { 
                style: { position: 'fixed', inset: 0, zIndex: 999999, background: '#0f172a', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#ef4444', fontFamily: 'sans-serif', padding: '20px' } 
            }, 
                e('div', { style: { fontSize: '20px', fontWeight: 'bold', marginBottom: '10px' } }, 'Failed to load secure asset.'),
                e('div', { style: { fontSize: '14px', color: '#94a3b8', marginBottom: '20px' } }, errorMsg),
                e('button', { onClick: onClose, style: { padding: '8px 16px', background: '#334155', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' } }, 'Close Player')
            );
        }

        return e('div', {
            style: {
                position: 'fixed', top: 0, left: 0, width: '100vw', height: '100dvh',
                zIndex: 999999, backgroundColor: '#0f172a', overflowY: 'auto',
                animation: 'fadeIn 0.3s ease-in-out'
            }
        },
            e('button', {
                onClick: onClose,
                style: {
                    position: 'fixed', top: '20px', right: '20px', zIndex: 1000000, 
                    background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', 
                    color: '#fff', borderRadius: '50%', width: '40px', height: '40px', 
                    cursor: 'pointer', fontSize: '24px', display: 'flex', alignItems: 'center', 
                    justifyContent: 'center', backdropFilter: 'blur(5px)'
                },
                innerHTML: '×'
            }),
            // 🚀 FIX: Unique ID for the player engine to hook into
            e('div', { id: 'koba-bloom-player-mount', style: { width: '100%', height: '100%' } })
        );
    };

    // ==========================================
    // 2. THE STOREFRONT CATALOG (The Auto-Page Generator)
    // ==========================================
    const JubileeCatalogApp = ({ studioKey, config }) => {
        const { useState, useEffect, createElement: e } = window.React;
        const [books, setBooks] = useState([]);
        const [loading, setLoading] = useState(true);
        const [errorMsg, setErrorMsg] = useState(null);
        const [activeAssetId, setActiveAssetId] = useState(null);

        useEffect(() => {
            let isMounted = true;
            console.log("[KOBA-I Catalog] App Mounted. Fetching assets for key:", studioKey);
            
            if (!studioKey) {
                if (isMounted) {
                    setErrorMsg("Missing KOBA-I Studio Key. Please verify your WordPress gateway settings.");
                    setLoading(false);
                }
                return;
            }

            const fetchCatalog = async () => {
                try {
                    const res = await fetch(`${config.endpoints.publicProduct}?studioKey=${studioKey}`);
                    const text = await res.text();
                    
                    let data;
                    try {
                        data = JSON.parse(text);
                    } catch (e) {
                        throw new Error("Server returned invalid response structure. Gateway may be misconfigured.");
                    }

                    if (!isMounted) return;

                    if (!res.ok || (data && data.error)) {
                        throw new Error(data.error || "Failed to authorize catalog request.");
                    }
                    
                    console.log("[KOBA-I Catalog] Payload Received Successfully.");
                    
                    let productArray = [];
                    if (Array.isArray(data)) {
                        productArray = data;
                    } else if (data && Array.isArray(data.products)) {
                        productArray = data.products;
                    }

                    setBooks(productArray);
                    setLoading(false);
                    
                } catch (err) {
                    if (!isMounted) return;
                    console.error("[KOBA-I Catalog] Fetch Error:", err); 
                    setErrorMsg(err.message || "Failed to communicate with the Command Center.");
                    setLoading(false);
                }
            };

            fetchCatalog();

            return () => { isMounted = false; };
        }, [studioKey]);

        // Rendering States
        if (loading) {
            return e('div', { style: { padding: '40px', textAlign: 'center', color: '#64748b', fontFamily: 'system-ui' } }, 
                e('div', { style: { width: '30px', height: '30px', border: '3px solid #e2e8f0', borderTopColor: '#3b82f6', borderRadius: '50%', display: 'inline-block', animation: 'spin 1s linear infinite', marginBottom: '15px' } }),
                e('div', { style: { fontWeight: '500' } }, 'Synchronizing Secure Catalog...')
            );
        }
        
        if (errorMsg) {
            return e('div', { style: { padding: '30px', textAlign: 'center', background: '#fee2e2', color: '#991b1b', border: '1px solid #f87171', borderRadius: '8px', fontFamily: 'system-ui' } }, 
                e('div', { style: { fontWeight: 'bold', fontSize: '18px', marginBottom: '8px' } }, 'Catalog Synchronization Failed'),
                e('div', { style: { fontSize: '14px' } }, errorMsg)
            );
        }

        if (books.length === 0) {
            return e('div', { style: { padding: '40px', textAlign: 'center', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '8px', color: '#475569', fontFamily: 'system-ui' } }, 
                'Your storefront is currently empty. Assets must be set to "Published" in the KOBA-I Studio.'
            );
        }

        const grid = e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '24px', fontFamily: 'system-ui' } },
            books.map(book => e('div', {
                key: book.id || Math.random().toString(),
                onClick: () => setActiveAssetId(book.id),
                style: { cursor: 'pointer', background: '#1e293b', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', transition: 'transform 0.2s ease, box-shadow 0.2s ease' },
                onMouseEnter: (e) => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0,0,0,0.1)'; },
                onMouseLeave: (e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(0,0,0,0.1)'; }
            },
                e('div', { style: { aspectRatio: '2/3', background: '#0f172a', position: 'relative' } },
                    e('img', { src: book.coverArtUrl, alt: book.title, style: { width: '100%', height: '100%', objectFit: 'cover' }, onError: (e) => e.target.style.display = 'none' }),
                    e('div', { style: { position: 'absolute', bottom: '10px', right: '10px', background: 'rgba(15, 23, 42, 0.85)', color: '#fff', padding: '4px 8px', borderRadius: '6px', fontSize: '13px', fontWeight: 'bold', backdropFilter: 'blur(4px)' } }, '$' + parseFloat(book.price || 0).toFixed(2))
                ),
                e('div', { style: { padding: '16px' } },
                    e('h3', { style: { color: '#fff', margin: '0 0 6px 0', fontSize: '16px', fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, book.title || 'Untitled Book'),
                    e('p', { style: { color: '#94a3b8', margin: 0, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '500' } }, book.type || 'Audiobook')
                )
            ))
        );

        return e('div', { className: 'jubilee-catalog-wrapper' },
            grid,
            activeAssetId && e(JubileePlayerApp, {
                assetId: activeAssetId,
                studioKey: studioKey,
                config: config,
                onClose: () => setActiveAssetId(null)
            })
        );
    };

    // ==========================================
    // 3. SYSTEM BOOTSTRAP
    // ==========================================
    const bootKobaSystems = () => {
        // Safe check for React globals
        if (!window.React || !window.ReactDOM) {
            console.warn("[KOBA-I] Waiting for React dependencies...");
            setTimeout(bootKobaSystems, 100);
            return;
        }

        const { createElement: e } = window.React;
        // Default to production dashboard if config is missing
        const config = window.JubileeConfig || { 
            endpoints: { 
                publicProduct: "https://dashboard.koba-i.com/api/products/public", 
                checkout: "https://dashboard.koba-i.com/api/checkout" 
            }
        };
        
        // 1. Mount Catalog
        const catalogNode = document.getElementById("jubilee-catalog-root");
        if (catalogNode && !catalogNode.hasAttribute('data-mounted')) {
            console.log("[KOBA-I] Initializing Catalog Mount Point...");
            catalogNode.setAttribute('data-mounted', 'true');
            const studioKey = catalogNode.getAttribute("data-studio-key");
            
            try {
                const root = window.ReactDOM.createRoot(catalogNode);
                root.render(e(JubileeCatalogApp, { studioKey, config }));
            } catch (err) {
                console.error("[KOBA-I] React mounting sequence failed:", err);
                catalogNode.innerHTML = `<div style="color:red; padding:20px; border:1px solid red;">Fatal Engine Error: ${err.message}</div>`;
            }
        }

        // 2. Mount Direct Player (If shortcode used outside catalog)
        const playerNode = document.getElementById("jubilee-bloom-root");
        if (playerNode && !catalogNode && !playerNode.hasAttribute('data-mounted')) {
             console.log("[KOBA-I] Initializing Direct Player Mount Point...");
             playerNode.setAttribute('data-mounted', 'true');
             const assetId = playerNode.getAttribute("data-asset");
             const studioKey = playerNode.getAttribute("data-studio-key");
             
             try {
                 const root = window.ReactDOM.createRoot(playerNode);
                 root.render(e(JubileePlayerApp, { 
                     assetId, studioKey, config, 
                     onClose: () => { playerNode.innerHTML = '<div style="padding: 20px; color: #64748b; font-family: system-ui;">Player Closed. Refresh to reload.</div>'; } 
                 }));
             } catch (err) {
                 console.error("[KOBA-I] Player mounting sequence failed:", err);
                 playerNode.innerHTML = `<div style="color:red; padding:20px; border:1px solid red;">Fatal Player Error: ${err.message}</div>`;
             }
        }
    };

    // Ensure DOM is ready before probing for mount points
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootKobaSystems);
    } else {
        bootKobaSystems();
    }
    
})();