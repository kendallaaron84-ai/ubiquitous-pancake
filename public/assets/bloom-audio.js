/**
 * KOBA-I: Audiobook Engine (DOM Hardware Bypass + Anti-Piracy Shield)
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
            
            <audio id="koba-audio-hardware" crossorigin="anonymous" src="${data.audioUrl || (chapters[0] ? chapters[0].url : '')}"></audio>
            
            <div style="width: 100%; height: 6px; background: rgba(255,255,255,0.2); border-radius: 3px; margin-bottom: 30px; cursor: pointer; position: relative;">
                <div id="koba-progress-fill" style="width: 0%; height: 100%; background: #10b981; border-radius: 3px; transition: width 0.1s linear;"></div>
            </div>

            <div style="display: flex; gap: 30px; align-items: center;">
                <button id="koba-btn-play" style="background: #10b981; color: #0a0f1a; border: none; width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; font-size: 24px;">▶</button>
            </div>
            
            <div style="margin-top: 40px; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">
                Protected by KOBA-I Voice Vault
            </div>
        </div>
    `;

    // 🚀 4GB RAM Optimization: Direct DOM Progress Binding
    const audioNode = document.getElementById('koba-audio-hardware');
    const playBtn = document.getElementById('koba-btn-play');
    const progressFill = document.getElementById('koba-progress-fill');

    let audioCtx;
    let oscillator;
    let isShieldActive = false;

    // 🚀 Phase 6 Compliance: Initialize the Web Audio API Shield
    const initAntiPiracyShield = () => {
        if (isShieldActive) return;
        
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
        
        // 1. Route the clean audio chapter
        const source = audioCtx.createMediaElementSource(audioNode);
        
        // 2. Generate the 19kHz-21kHz interdiction frequency
        oscillator = audioCtx.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(20000, audioCtx.currentTime); // 20kHz (Inaudible to most humans, corrupts unauthorized rips)
        
        // Lower the volume of the oscillator so it doesn't overload the hardware DAC
        const oscGain = audioCtx.createGain();
        oscGain.gain.value = 0.1;
        oscillator.connect(oscGain);
        
        // 3. Merge the clean audio with the shield
        source.connect(audioCtx.destination);
        oscGain.connect(audioCtx.destination);
        
        oscillator.start();
        isShieldActive = true;
    };

    if (audioNode && playBtn) {
        let isPlaying = false;
        
        playBtn.addEventListener('click', () => {
            if (isPlaying) {
                audioNode.pause();
                if (audioCtx && audioCtx.state === 'running') {
                    audioCtx.suspend();
                }
                playBtn.innerHTML = '▶';
            } else {
                initAntiPiracyShield();
                if (audioCtx && audioCtx.state === 'suspended') {
                    audioCtx.resume();
                }
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