/**
 * KOBA-I JUBILEE WORKS: Universal Agnostic Rendering Engine
 * Refactored to pure React.createElement to bypass JSX browser SyntaxErrors.
 */

const { useState, useEffect, createElement: e } = window.React;

// ==========================================
// 1. THE MEDIA PLAYER COMPONENT (The Bloom Overlay)
// ==========================================
const JubileePlayerApp = ({ assetId, studioKey, config, onClose }) => {
    const [status, setStatus] = useState('loading'); // loading, ready, error

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

                if (!response.ok) throw new Error(response.status === 403 ? "Tenant Key Invalid" : "Asset Not Found");

                const data = await response.json();
                
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
                setStatus('error');
            }
        };

        fetchSaaSData();
    }, [assetId, studioKey]); // 🚀 Config removed from dependency array to guarantee NO API loops

    if (status === 'loading') {
        return e('div', { style: { position: 'fixed', inset: 0, zIndex: 999999, background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: 'sans-serif' } }, 'Decrypting Secure Stream...');
    }

    if (status === 'error') {
        return e('div', { style: { color: '#ef4444', padding: '20px', textAlign: 'center' } }, 'Failed to load secure asset.');
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
    const [activeAssetId, setActiveAssetId] = useState(null);

    useEffect(() => {
        fetch(`${config.endpoints.publicProduct}?studioKey=${studioKey}`)
            .then(res => res.json())
            .then(data => { setBooks(data); setLoading(false); })
            .catch(err => { console.error(err); setLoading(false); });
    }, [studioKey]); // 🚀 Config removed from dependency array to guarantee NO API loops

    if (loading) return e('div', { style: { padding: '40px', textAlign: 'center', color: '#64748b' } }, 'Syncing Secure Catalog...');
    if (books.length === 0) return e('div', { style: { padding: '40px', textAlign: 'center', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '8px' } }, 'Your storefront is currently empty.');

    const grid = e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px', fontFamily: 'sans-serif' } },
        books.map(book => e('div', {
            key: book.id,
            onClick: () => setActiveAssetId(book.id), // Clicking a book launches the Bloom Player Overlay!
            style: { cursor: 'pointer', background: '#1e293b', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }
        },
            e('div', { style: { aspectRatio: '2/3', background: '#0f172a', position: 'relative' } },
                e('img', { src: book.coverArtUrl, style: { width: '100%', height: '100%', objectFit: 'cover' }, onError: (e) => e.target.style.display = 'none' }),
                e('div', { style: { position: 'absolute', bottom: '10px', right: '10px', background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 'bold' } }, '$' + parseFloat(book.price || 0).toFixed(2))
            ),
            e('div', { style: { padding: '12px' } },
                e('h3', { style: { color: '#fff', margin: '0 0 4px 0', fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, book.title),
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

    // Mount Single Player (if placed manually via [jubilee_player])
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
// Because WordPress injects this script late in the footer, DOMContentLoaded has likely ALREADY FIRED.
// We must check if the document is already loaded, and if so, boot immediately.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootKobaSystems);
} else {
    bootKobaSystems();
}