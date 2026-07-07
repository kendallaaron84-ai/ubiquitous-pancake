/**
 * KOBA-I: Audiobook Engine (DOM Hardware Bypass)
 * File: public/assets/bloom-audio.js
 */

window.initBloomAudio = function(root, data) {
    const chapters = data.chapters || [];
    
    // Inject the fixed-viewport audiobook UI
    root.innerHTML = `
        <div style="position: absolute; inset: 0; background-image: url('${data.bgImageUrl || data.coverArtUrl}'); background-size: cover; background-position: center; filter: blur(30px) brightness(0.2); z-index: -1;"></div>
        
        <div style="display: flex; flex-direction: column; align-items: center; width: 100%; max-width: 450px; padding: 20px;">
            <img src="${data.coverArtUrl}" style="width: 280px; height: 280px; object-fit: cover; border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7); margin-bottom: 40px;" onerror="this.style.display='none'"/>
            
            <h1 style="color: white; font-size: 24px; font-weight: 800; text-align: center; margin: 0 0 8px 0;">${data.title}</h1>
            <h2 style="color: #94a3b8; font-size: 16px; font-weight: 500; text-align: center; margin: 0 0 30px 0;">${data.authorName || 'Sovereign Author'}</h2>
            
            <!-- Hardware Bypass Audio Node -->
            <audio id="koba-audio-hardware" src="${data.audioUrl || (chapters[0] ? chapters[0].url : '')}"></audio>
            
            <!-- Custom Scrub Bar (Direct DOM manipulation target) -->
            <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.2); border-radius: 3px; margin-bottom: 30px; cursor: pointer; position: relative;">
                <div id="koba-progress-fill" style="width: 0%; height: 100%; background: #10b981; border-radius: 3px; transition: width 0.1s linear;"></div>
            </div>

            <!-- Controls -->
            <div style="display: flex; gap: 30px; align-items: center;">
                <button id="koba-btn-play" style="background: #10b981; color: #0a0f1a; border: none; width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 24px;">▶</button>
            </div>
            
            <div style="margin-top: 40px; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">
                Protected by KOBA-I Voice Vault
            </div>
        </div>
    `;

    // 🚀 4GB RAM Optimization: Direct DOM Progress Binding (No React State)
    const audioNode = document.getElementById('koba-audio-hardware');
    const playBtn = document.getElementById('koba-btn-play');
    const progressFill = document.getElementById('koba-progress-fill');

    if (audioNode && playBtn) {
        let isPlaying = false;
        
        playBtn.addEventListener('click', () => {
            if (isPlaying) {
                audioNode.pause();
                playBtn.innerHTML = '▶';
            } else {
                audioNode.play();
                playBtn.innerHTML = '⏸';
            }
            isPlaying = !isPlaying;
        });

        // Mutates the DOM strictly outside of virtual DOM loops
        audioNode.addEventListener('timeupdate', () => {
            if (audioNode.duration) {
                const percent = (audioNode.currentTime / audioNode.duration) * 100;
                progressFill.style.width = `${percent}%`;
            }
        });
    }
};