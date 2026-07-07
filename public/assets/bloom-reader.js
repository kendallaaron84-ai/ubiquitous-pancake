/**
 * KOBA-I: E-Reader Engine (Horizontal Pagination & RAG Lore)
 * File: public/assets/bloom-reader.js
 */

window.initBloomReader = function(root, data) {
    // Inject the E-Reader Layout (Solid background, Sidebar + Multi-Column Container)
    root.innerHTML = `
        <div style="width: 100%; height: 100%; background: #f8fafc; color: #334155; display: flex; overflow: hidden; font-family: Georgia, serif;">
            
            <!-- LEFT SIDEBAR: RAG Lore & Constraints -->
            <div style="width: 280px; height: 100%; background: #0f172a; color: #e2e8f0; padding: 30px 20px; border-right: 1px solid #334155; overflow-y: auto; flex-shrink: 0; font-family: sans-serif;">
                <h3 style="color: #10b981; font-size: 12px; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 20px;">RAG Identity Vector</h3>
                <h2 style="font-size: 18px; margin-bottom: 10px; color: white;">${data.title}</h2>
                <p style="font-size: 13px; line-height: 1.6; color: #94a3b8; margin-bottom: 20px;">${data.synopsis || 'Interactive lore and world-building notes dynamically load here.'}</p>
                <div style="font-size: 11px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 6px; border-left: 3px solid #10b981;">
                    <strong>Active Constraints:</strong> Custom mood and setting parameters are actively engaged.
                </div>
            </div>

            <!-- RIGHT WORKSPACE: Horizontal Paginated E-Reader -->
            <div style="flex: 1; height: 100%; position: relative; padding: 40px; display: flex; flex-direction: column;">
                
                <!-- The CSS Multi-Column Hack for Zero Vertical Scrolling -->
                <div id="koba-page-viewport" style="flex: 1; overflow: hidden; position: relative;">
                    <div id="koba-text-content" style="
                        height: 100%;
                        column-width: calc(100vw - 360px); /* Total width minus sidebar and padding */
                        column-gap: 80px;
                        column-fill: auto;
                        transition: transform 0.4s cubic-bezier(0.25, 1, 0.5, 1);
                        font-size: 18px;
                        line-height: 1.8;
                        text-align: justify;
                        padding-bottom: 20px;
                    ">
                        <!-- Safe fallback for E-book text -->
                        ${data.ebookPayload || '<p>Manuscript text parsing initialized...</p><p>Subsequent paragraphs are automatically paginated horizontally.</p>'}
                    </div>
                </div>

                <!-- Horizontal Pagination Controls -->
                <div style="height: 60px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #e2e8f0; margin-top: 20px; font-family: sans-serif;">
                    <button id="koba-prev-page" style="background: transparent; border: 1px solid #cbd5e1; padding: 8px 16px; border-radius: 20px; cursor: pointer; color: #64748b; font-weight: bold;">← Previous</button>
                    <span id="koba-page-indicator" style="font-size: 13px; color: #94a3b8;">Page 1</span>
                    <button id="koba-next-page" style="background: transparent; border: 1px solid #cbd5e1; padding: 8px 16px; border-radius: 20px; cursor: pointer; color: #64748b; font-weight: bold;">Next →</button>
                </div>
            </div>
        </div>
    `;

    // 🚀 NO VERTICAL SCROLL LOGIC (Horizontal Container Shifting)
    let currentPage = 0;
    const content = document.getElementById('koba-text-content');
    const viewport = document.getElementById('koba-page-viewport');
    const indicator = document.getElementById('koba-page-indicator');
    
    document.getElementById('koba-next-page').addEventListener('click', () => {
        // Calculate total virtual pages based on scroll width vs container width
        const totalPages = Math.ceil(content.scrollWidth / viewport.clientWidth);
        if (currentPage < totalPages - 1) {
            currentPage++;
            // Shift the container to the left by exactly one column width + gap
            content.style.transform = `translateX(-${currentPage * (viewport.clientWidth + 80)}px)`;
            indicator.innerText = `Page ${currentPage + 1}`;
        }
    });

    document.getElementById('koba-prev-page').addEventListener('click', () => {
        if (currentPage > 0) {
            currentPage--;
            content.style.transform = `translateX(-${currentPage * (viewport.clientWidth + 80)}px)`;
            indicator.innerText = `Page ${currentPage + 1}`;
        }
    });
};