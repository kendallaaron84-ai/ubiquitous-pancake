/**
 * KOBA-I JUBILEE WORKS: Universal Agnostic Rendering Engine
 * Refactored to pure React.createElement to bypass JSX browser SyntaxErrors.
 * 🚀 Added Extreme Defensiveness & Visual Error Boundaries
 */

const { useState, useEffect, createElement: e } = window.React;

// ==========================================
// 1. THE MEDIA PLAYER COMPONENT (The Bloom Overlay)
// ==========================================
const JubileePlayerApp = ({ assetId, studioKey, config, onClose }) => {
    const [status, setStatus] = useState('loading'); // loading, ready, error
    const [errorMsg, setErrorMsg] = useState('');

    useEffect(() => {
        const fetchSaaSData = async () => {
            try {
                const response = await fetch(`${config.endpoints.publicProduct}?assetId=${assetId}`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Studio-Key': studioKey
                    }
                });

                const data = await response.json();

                if (!response.ok || data.error) {
                    throw new Error(data.error || (response.status === 403 ? "Tenant Key Invalid" : "Asset Not Found"));
                }
                
                // Mount global data for the audio player
                window.kobaData = data;
                setStatus('ready');

                // Trigger the actual Bloom Player logic
                setTimeout(() => {
                    const root = document.getElementById('koba-bloom-root');
                    if (root && window.initBloomPlayer) {
                        window.initBloomPlayer(root, data, 'full');
                    }
                }, 50);

            } catch (error) {
                console.error("Jubilee Cloud Error:", error);
                setErrorMsg(error.message);
                setStatus('error');
            }
        };

        fetchSaaSData();
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

    // The True Blank Canvas: Fixed Overlay replacing the WordPress Hijacker
    return e('div', {
        style: {
            position: 'fixed', top: 0, left: 0, width: '100vw', height: '100dvh',
            zIndex: 999999, backgroundColor: '#0f172a', overflowY: 'auto',
            animation: 'fadeIn 0.3s ease-in-out'
        }
    },
        // Close Canvas Button
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
        // The mount point that bloom-player.js hooks into
        e('div', { id: 'koba-bloom-root' })
    );
};

// ==========================================
// 2. THE STOREFRONT CATALOG (The Auto-Page Generator)
// ==========================================
const JubileeCatalogApp = ({ studioKey, config }) => {
    const [books, setBooks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [errorMsg, setErrorMsg] = useState(null);
    const [activeAssetId, setActiveAssetId] = useState(null);

    useEffect(() => {
        if (!studioKey) {
            setErrorMsg("Missing WPStudioKey. Please check your WordPress gateway settings.");
            setLoading(false);
            return;
        }

        fetch(`${config.endpoints.publicProduct}?studioKey=${studioKey}`)
            .then(async res => {
                const text = await res.text();
                try {
                    return JSON.parse(text);
                } catch (e) {
                    throw new Error("Server returned invalid JSON. Could be a 500 error or a 404 page: " + text.substring(0, 100));
                }
            })
            .then(data => {
                // 🚀 HIGHLY DEFENSIVE PARSING: Prevents silent React fatal crashes if API returns an object or error
                if (data && data.error) {
                    throw new Error(data.error);
                }
                
                let productArray = [];
                if (Array.isArray(data)) {
                    productArray = data;
                } else if (data && Array.isArray(data.products)) {
                    productArray = data.products;
                }

                setBooks(productArray);
                setLoading(false);
            })
            .catch(err => { 
                console.error("KOBA-I Catalog Fetch Error:", err); 
                setErrorMsg(err.message || "Failed to communicate with the Command Center.");
                setLoading(false); 
            });
    }, [studioKey]);

    if (loading) return e('div', { style: { padding: '40px', textAlign: 'center', color: '#64748b' } }, 'Syncing Secure Catalog...');
    
    // Visual Error Boundary
    if (errorMsg) return e('div', { style: { padding: '40px', textAlign: 'center', background: '#fee2e2', color: '#991b1b', border: '1px solid #f87171', borderRadius: '8px' } }, 
        e('strong', null, 'Cloud Engine Error: '), errorMsg
    );

    if (books.length === 0) return e('div', { style: { padding: '40px', textAlign: 'center', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '8px', color: '#475569' } }, 'Your storefront is currently empty. Assets must be set to "Published" in the KOBA-I Studio.');

    const grid = e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px', fontFamily: 'sans-serif' } },
        books.map(book => e('div', {
            key: book.id || Math.random(),
            onClick: () => setActiveAssetId(book.id), // Clicking a book launches the Bloom Player Overlay
            style: { cursor: 'pointer', background: '#1e293b', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }
        },
            e('div', { style: { aspectRatio: '2/3', background: '#0f172a', position: 'relative' } },
                e('img', { src: book.coverArtUrl, style: { width: '100%', height: '100%', objectFit: 'cover' }, onError: (e) => e.target.style.display = 'none' }),
                e('div', { style: { position: 'absolute', bottom: '10px', right: '10px', background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' } }, '$' + parseFloat(book.price || 0).toFixed(2))
            ),
            e('div', { style: { padding: '12px' } },
                e('h3', { style: { color: '#fff', margin: '0 0 4px 0', fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, book.title || 'Untitled Book'),
                e('p', { style: { color: '#94a3b8', margin: 0, fontSize: '11px', textTransform: 'uppercase' } }, book.type || 'Audiobook')
            )
        ))
    );

    return e('div', null,
        grid,
        // If a book is clicked, mount the Player Overlay on top of the catalog
        activeAssetId && e(JubileePlayerApp, {
            assetId: activeAssetId,
            studioKey: studioKey,
            config: config,
            onClose: () => setActiveAssetId(null) // Unmounts the player and returns to catalog
        })
    );
};

// ==========================================
// 3. SYSTEM BOOTSTRAP (Finding the shortcodes)
// ==========================================
const bootKobaSystems = () => {
    const config = window.JubileeConfig || { 
        endpoints: { 
            publicProduct: "https://dashboard.koba-i.com/api/products/public", 
            checkout: "https://dashboard.koba-i.com/api/checkout" 
        }
    };
    
    // Mount Catalog
    const catalogNode = document.getElementById("jubilee-catalog-root");
    if (catalogNode) {
        const studioKey = catalogNode.getAttribute("data-studio-key");
        const root = window.ReactDOM.createRoot(catalogNode);
        root.render(e(JubileeCatalogApp, { studioKey, config }));
    }

    // Mount Single Player (if placed manually via [koba_media_player])
    const playerNode = document.getElementById("jubilee-bloom-root");
    if (playerNode && !catalogNode) {
         const assetId = playerNode.getAttribute("data-asset");
         const studioKey = playerNode.getAttribute("data-studio-key");
         const root = window.ReactDOM.createRoot(playerNode);
         root.render(e(JubileePlayerApp, { 
             assetId, studioKey, config, 
             onClose: () => { playerNode.innerHTML = '<div style="padding: 20px; color: #fff;">Player Closed. Refresh to reload.</div>'; } 
         }));
    }
};

// 🚀 THE FIX: Race-Condition Defense
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootKobaSystems);
} else {
    bootKobaSystems();
}