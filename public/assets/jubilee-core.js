/**
 * KOBA-I JUBILEE WORKS: Universal Agnostic Rendering Engine (The Traffic Cop)
 * Refactored to pure React.createElement to bypass JSX browser SyntaxErrors.
 * 🚀 Zero Babel Required - Highly optimized for mobile & 4GB RAM devices
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

                // 🚀 DYNAMIC CSS CODE-SPLITTING: Determine split files to load dynamically
                const isEbook = assetId.startsWith('ebk_') || data.type === 'ebook' || data.type === 'E-Book';
                const themeSheetId = 'koba-theme-sheet';
                const playerEngineId = 'koba-player-engine-script';
                
                // Remove old stylesheet if active to prevent rendering collisions
                const oldSheet = document.getElementById(themeSheetId);
                if (oldSheet) oldSheet.remove();

                const oldScript = document.getElementById(playerEngineId);
                if (oldScript) oldScript.remove();

                // 1. Load Dynamic Split CSS Assets
                const link = document.createElement('link');
                link.id = themeSheetId;
                link.rel = 'stylesheet';
                link.href = `https://dashboard.koba-i.com/assets/css/bloom-${isEbook ? 'reader' : 'audio'}.css`;
                document.head.appendChild(link);

                // 2. Load Dynamic Split Javascript Engine
                const script = document.createElement('script');
                script.id = playerEngineId;
                script.src = `https://dashboard.koba-i.com/assets/bloom-${isEbook ? 'reader' : 'audio'}.js`;
                script.onload = () => {
                    setTimeout(() => {
                        const root = document.getElementById('koba-bloom-root');
                        if (root) {
                            if (isEbook && window.initBloomReader) {
                                window.initBloomReader(root, data);
                            } else if (!isEbook && window.initBloomAudio) {
                                window.initBloomAudio(root, data);
                            }
                        }
                    }, 50);
                };
                document.body.appendChild(script);

            } catch (error) {
                console.error("Jubilee Cloud Error:", error);
                setStatus('error');
            }
        };

        fetchSaaSData();
        // 🚀 RESOLVED LOOP: Primitive dependencies only. Removed transient 'config' object reference.
    }, [assetId, studioKey]);

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
            }
        }, '×'),
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
    }, [studioKey]);

    if (loading) return e('div', { style: { padding: '40px', textAlign: 'center', color: '#64748b' } }, 'Syncing Secure Catalog...');
    if (books.length === 0) return e('div', { style: { padding: '40px', textAlign: 'center', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '8px' } }, 'Your storefront is currently empty.');

    const grid = e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px', fontFamily: 'sans-serif' } },
        books.map(book => e('div', {
            key: book.id,
            onClick: () => setActiveAssetId(book.id), // Clicking a book launches the Bloom Player Overlay!
            style: { cursor: 'pointer', background: '#1e293b', border: '1px solid #334155', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }
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

// Force boot even if loaded dynamically on Wix/Shopify
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootKobaSystems);
} else {
    bootKobaSystems();
}