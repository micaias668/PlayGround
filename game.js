(() => {
  'use strict';
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const card = document.getElementById('overlayCard');
  const title = document.getElementById('cardTitle');
  const text = document.getElementById('cardText');
  const kicker = document.getElementById('cardKicker');
  const actionButton = document.getElementById('actionButton');
  const actionLabel = document.getElementById('actionLabel');
  const playGlyph = document.getElementById('playGlyph');
  const keyHint = document.getElementById('keyHint');
  const progressValue = document.getElementById('progressValue');
  const bestValue = document.getElementById('bestValue');
  const progressFill = document.getElementById('progressFill');
  const pauseButton = document.getElementById('pauseButton');
  const soundButton = document.getElementById('soundButton');
  const soundIcon = document.getElementById('soundIcon');
  const beatDots = [...document.querySelectorAll('.beat-dot')];
  const flash = document.getElementById('flash');

  const W = 1100, H = 550, GROUND = 438, PLAYER_SIZE = 38;
  const BPM = 112, BEAT = 60 / BPM, SPEED = 360, LEVEL_BEATS = 96;
  const LEVEL_LENGTH = LEVEL_BEATS * SPEED * BEAT;
  const PLAYER_X = 225;
  const obstacleMap = [
    [4,'spike'],[8,'double'],[12,'block'],[16,'spike'],[20,'double'],[24,'block'],
    [28,'spike'],[31,'double'],[35,'block'],[39,'spike'],[43,'double'],[47,'block'],
    [51,'spike'],[55,'double'],[59,'block'],[63,'spike'],[66,'double'],[70,'block'],
    [74,'double'],[78,'spike'],[82,'block'],[86,'double'],[90,'spike'],[93,'double']
  ];
  const obstacles = obstacleMap.map(([beat, type]) => ({ x: beat * SPEED * BEAT + 660, type, passed:false }));
  let scale = 1, viewW = W, viewH = H, dpr = 1;
  let state = 'ready', elapsed = 0, lastFrame = 0, lastBeat = -1, distance = 0;
  let y = GROUND - PLAYER_SIZE, vy = 0, grounded = true, rotation = 0;
  let particles = [], trail = [], soundOn = true, audio = null, best = readBest();
  let jumpCount = 0, perfectCount = 0, toast = '', toastUntil = 0, deathFlash = 0;

  function readBest(){ try { return Math.max(0, Math.min(100, Number(localStorage.getItem('pulseRunnerBest')) || 0)); } catch (_) { return 0; } }
  function resize(){
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
    scale = rect.height / H; viewW = rect.width / scale; viewH = H;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  }
  new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize); resize();

  function audioContext(){
    if (!audio) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) audio = new AC(); }
    if (audio && audio.state === 'suspended') audio.resume();
    return audio;
  }
  function tone(freq, duration=.055, type='sine', volume=.035){
    if (!soundOn) return;
    const a = audioContext(); if (!a) return;
    const osc = a.createOscillator(), gain = a.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, a.currentTime);
    gain.gain.setValueAtTime(volume, a.currentTime); gain.gain.exponentialRampToValueAtTime(.001, a.currentTime + duration);
    osc.connect(gain); gain.connect(a.destination); osc.start(); osc.stop(a.currentTime + duration);
  }
  function beatSound(index){ tone(index % 4 === 0 ? 880 : 620, index % 4 === 0 ? .09 : .045, 'sine', index % 4 === 0 ? .026 : .013); }
  function updateHud(pct){
    const percent = Math.max(0, Math.min(100, Math.floor(pct)));
    progressValue.textContent = `${String(percent).padStart(2,'0')}%`;
    progressFill.style.width = `${percent}%`;
    bestValue.textContent = `${String(best).padStart(2,'0')}%`;
  }
  function showOverlay(kind){
    overlay.className = `overlay ${kind || ''}`.trim();
    card.className = 'overlay-card';
    if (kind === 'paused') {
      kicker.textContent = 'TAKE A BREATHER'; title.innerHTML = 'Pause your<br><em>rhythm.</em>';
      text.innerHTML = 'Your run is waiting right where you left it.'; actionLabel.textContent = 'RESUME RUN'; keyHint.innerHTML = '<kbd>P</kbd> or <kbd>ESC</kbd> <span>to resume</span>';
    } else if (kind === 'dead') {
      kicker.textContent = 'THE BEAT GOES ON'; title.innerHTML = 'Almost had<br><em>that one.</em>';
      text.innerHTML = `${Math.floor(distance / LEVEL_LENGTH * 100)}% through the circuit · ${perfectCount} on-beat ${perfectCount === 1 ? 'jump' : 'jumps'}.<br>Listen for the pulse and try again.`;
      actionLabel.textContent = 'TRY AGAIN'; keyHint.innerHTML = '<kbd>ENTER</kbd> <span>or tap to retry</span>';
    } else if (kind === 'won') {
      kicker.textContent = 'CIRCUIT COMPLETE'; title.innerHTML = 'You found<br>your <em>flow.</em>';
      text.innerHTML = `${perfectCount} on-beat ${perfectCount === 1 ? 'jump' : 'jumps'} · clean finish.<br>Can you make it even smoother?`;
      actionLabel.textContent = 'RUN IT BACK'; keyHint.innerHTML = '<kbd>ENTER</kbd> <span>to play again</span>';
    } else {
      kicker.textContent = 'READY WHEN YOU ARE'; title.innerHTML = 'Find your<br><em>rhythm.</em>';
      text.innerHTML = 'Tap to jump. Land on the beat.<br>Don’t let the spikes break your flow.';
      actionLabel.textContent = 'START RUN'; keyHint.innerHTML = '<kbd>SPACE</kbd> or <kbd>↑</kbd> <span>to jump</span>';
    }
  }
  function reset(){
    elapsed = 0; distance = 0; y = GROUND - PLAYER_SIZE; vy = 0; grounded = true; rotation = 0;
    particles = []; trail = []; lastBeat = -1; jumpCount = 0; perfectCount = 0; toast = '';
    obstacles.forEach(o => o.passed = false); updateHud(0);
  }
  function start(){
    audioContext(); reset(); state = 'running'; overlay.className = 'overlay hidden';
    lastFrame = performance.now(); beatSound(0); lastBeat = 0;
  }
  function pause(){ if(state !== 'running') return; state='paused'; showOverlay('paused'); }
  function resume(){ if(state !== 'paused') return; state='running'; overlay.className='overlay hidden'; lastFrame=performance.now(); }
  function togglePause(){ if(state==='running') pause(); else if(state==='paused') resume(); }
  function jump(){
    if(state !== 'running' || !grounded) return;
    const beatFloat = elapsed / BEAT, nearest = Math.round(beatFloat), delta = Math.abs(beatFloat-nearest)*BEAT;
    const perfect = delta < .115;
    vy = -785; grounded = false; jumpCount++;
    if(perfect){ perfectCount++; toast='ON BEAT'; toastUntil=elapsed+.62; tone(1040,.12,'triangle',.05); }
    else tone(440,.065,'triangle',.025);
    for(let i=0;i<8;i++) particles.push({x:PLAYER_X+PLAYER_SIZE/2,y:GROUND-2,vx:(Math.random()-.5)*150,vy:-Math.random()*180-35,life:.25+Math.random()*.3,size:2+Math.random()*3,color:perfect?'#c8ff4d':'#8e78ff'});
  }
  function die(){
    if(state!=='running') return;
    state='dead'; const pct=Math.floor(distance/LEVEL_LENGTH*100); best=Math.max(best,pct);
    try{localStorage.setItem('pulseRunnerBest',String(best));}catch(_){}
    updateHud(pct); showOverlay('dead'); overlay.classList.add('dead');
    tone(150,.3,'sawtooth',.045); deathFlash=.8;
    for(let i=0;i<22;i++) particles.push({x:PLAYER_X+PLAYER_SIZE/2,y:y+PLAYER_SIZE/2,vx:(Math.random()-.5)*440,vy:(Math.random()-.5)*440,life:.35+Math.random()*.5,size:2+Math.random()*5,color:i%2?'#ff658a':'#c8ff4d'});
  }
  function finish(){
    state='won'; distance=LEVEL_LENGTH; best=100;
    try{localStorage.setItem('pulseRunnerBest','100');}catch(_){}
    updateHud(100); showOverlay('won'); overlay.classList.add('won'); tone(880,.2,'triangle',.06); setTimeout(()=>tone(1175,.3,'triangle',.05),130);
  }
  function activate(){
    if(state==='ready'||state==='dead'||state==='won') start();
    else if(state==='paused') resume();
  }
  actionButton.addEventListener('click',activate);
  pauseButton.addEventListener('click',togglePause);
  soundButton.addEventListener('click',()=>{
    soundOn=!soundOn; soundButton.classList.toggle('muted',!soundOn);
    soundIcon.textContent=soundOn?'♫':'♪'; soundButton.querySelector('.sound-label').textContent=soundOn?'SOUND ON':'SOUND OFF';
    soundButton.setAttribute('aria-label',soundOn?'Toggle sound off':'Toggle sound on');
    if(soundOn) audioContext();
  });
  canvas.addEventListener('pointerdown',e=>{ e.preventDefault(); if(state==='running') jump(); else if(state==='ready'||state==='dead'||state==='won') activate(); });
  window.addEventListener('keydown',e=>{
    if(['Space','ArrowUp','ArrowDown'].includes(e.code)) e.preventDefault();
    if((e.code==='Space'||e.code==='ArrowUp'||e.code==='KeyW')&&!e.repeat){ if(state==='running') jump(); else if(state==='ready'||state==='dead'||state==='won') activate(); }
    if(e.code==='KeyP'||e.code==='Escape') togglePause();
    if(e.code==='Enter'&&(state==='dead'||state==='won')) activate();
  });

  function roundedRect(x,y,w,h,r){
    ctx.beginPath(); ctx.roundRect(x,y,w,h,r);
  }
  function drawBackground(t){
    const w=viewW, h=viewH;
    const sky=ctx.createLinearGradient(0,0,0,h); sky.addColorStop(0,'#111427'); sky.addColorStop(.63,'#17192d'); sky.addColorStop(1,'#111324');
    ctx.fillStyle=sky; ctx.fillRect(0,0,w,h);
    const glow=ctx.createRadialGradient(w*.74,h*.25,5,w*.74,h*.25,Math.max(w,h)*.67);
    glow.addColorStop(0,'rgba(118,94,255,.13)'); glow.addColorStop(1,'rgba(118,94,255,0)'); ctx.fillStyle=glow;ctx.fillRect(0,0,w,h);
    const glow2=ctx.createRadialGradient(w*.1,h*.64,2,w*.1,h*.64,Math.max(w,h)*.45);
    glow2.addColorStop(0,'rgba(112,255,179,.055)');glow2.addColorStop(1,'rgba(112,255,179,0)');ctx.fillStyle=glow2;ctx.fillRect(0,0,w,h);
    for(let i=0;i<38;i++){
      const sx=(i*173+37)%Math.ceil(w), sy=(i*71+29)%300+38, tw=1+(i%3===0?1:0);
      ctx.globalAlpha=.22+((Math.sin(t*1.3+i)*.5+.5)*.32); ctx.fillStyle=i%6===0?'#c8ff4d':'#b8bce5'; ctx.fillRect(sx,sy,tw,tw);
    }
    ctx.globalAlpha=1;
    // Distant angular skyline, drifting at half speed.
    const skylineY=GROUND-40, shift=(distance*.15)%240;
    ctx.beginPath();ctx.moveTo(0,skylineY);
    for(let i=-1;i<Math.ceil(w/120)+2;i++){
      const x=i*120-shift; const peak=skylineY-30-((i*37+83)%58);
      ctx.lineTo(x,skylineY);ctx.lineTo(x+42,peak);ctx.lineTo(x+94,skylineY);
    }
    ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.closePath();ctx.fillStyle='rgba(20,23,43,.56)';ctx.fill();
    ctx.strokeStyle='rgba(142,120,255,.12)';ctx.lineWidth=1;ctx.beginPath();
    for(let i=-1;i<Math.ceil(w/120)+2;i++){const x=i*120-shift;const peak=skylineY-30-((i*37+83)%58);ctx.moveTo(x+42,peak);ctx.lineTo(x+94,skylineY);}
    ctx.stroke();
    // Subtle scan grid and perspective floor.
    ctx.strokeStyle='rgba(133,139,189,.075)';ctx.lineWidth=1;
    const offset=(distance*.45)%64;
    for(let x=-64-offset;x<w+64;x+=64){ctx.beginPath();ctx.moveTo(x,GROUND);ctx.lineTo(x-25,h);ctx.stroke();}
    for(let y=GROUND+13;y<h;y+=18){ctx.globalAlpha=.2+(y-GROUND)/(h-GROUND)*.35;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
    ctx.globalAlpha=1;
    // Small beat-responsive horizon rings.
    const pulse=.5+.5*Math.sin(t/BEAT*Math.PI*2);
    ctx.strokeStyle=`rgba(200,255,77,${.04+pulse*.035})`;ctx.lineWidth=1;
    ctx.beginPath();ctx.ellipse(w*.72,GROUND-75,80+pulse*10,17+pulse*3,0,0,Math.PI*2);ctx.stroke();
  }
  function drawGround(t){
    const w=viewW;
    const grd=ctx.createLinearGradient(0,GROUND,0,viewH);grd.addColorStop(0,'#20233a');grd.addColorStop(1,'#101221');
    ctx.fillStyle=grd;ctx.fillRect(0,GROUND,w,viewH-GROUND);
    ctx.fillStyle='#8e78ff';ctx.globalAlpha=.72;ctx.fillRect(0,GROUND,w,2);ctx.globalAlpha=1;
    ctx.fillStyle='#c8ff4d';ctx.globalAlpha=.76;ctx.fillRect(0,GROUND,w,1);ctx.globalAlpha=1;
    const stride=96, off=distance%stride;
    for(let x=-off;x<w+stride;x+=stride){
      const glow=Math.max(0,1-Math.abs(x-PLAYER_X)/260)*.5;
      ctx.fillStyle=`rgba(200,255,77,${.1+glow})`;ctx.fillRect(x+8,GROUND+9,22,2);
    }
    const sheen=ctx.createLinearGradient(0,GROUND-4,0,GROUND+10);sheen.addColorStop(0,'rgba(255,255,255,.14)');sheen.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=sheen;ctx.fillRect(0,GROUND-3,w,13);
  }
  function drawSpike(x, double=false){
    const size=36, gap=5, count=double?2:1, h=38;
    for(let i=0;i<count;i++){
      const sx=x+i*(size+gap);
      ctx.save();ctx.shadowColor='rgba(200,255,77,.36)';ctx.shadowBlur=14;
      ctx.beginPath();ctx.moveTo(sx,GROUND);ctx.lineTo(sx+size/2,GROUND-h);ctx.lineTo(sx+size,GROUND);ctx.closePath();
      const grad=ctx.createLinearGradient(sx,GROUND-h,sx+size,GROUND);grad.addColorStop(0,'#e1ff8a');grad.addColorStop(.46,'#c8ff4d');grad.addColorStop(1,'#83cf45');
      ctx.fillStyle=grad;ctx.fill();ctx.shadowBlur=0;
      ctx.strokeStyle='rgba(245,255,203,.75)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(sx+2,GROUND-2);ctx.lineTo(sx+size/2,GROUND-h+2);ctx.stroke();ctx.restore();
    }
  }
  function drawBlock(x){
    const size=42, top=GROUND-size;
    ctx.save();ctx.shadowColor='rgba(142,120,255,.52)';ctx.shadowBlur=17;
    const grad=ctx.createLinearGradient(x,top,x+size,GROUND);grad.addColorStop(0,'#9b88ff');grad.addColorStop(1,'#6756d8');
    ctx.fillStyle=grad;roundedRect(x,top,size,size,4);ctx.fill();ctx.shadowBlur=0;
    ctx.strokeStyle='rgba(226,220,255,.74)';ctx.lineWidth=1;roundedRect(x+4,top+4,size-8,size-8,2);ctx.stroke();
    ctx.fillStyle='rgba(255,255,255,.17)';ctx.fillRect(x+8,top+8,5,5);ctx.restore();
  }
  function drawObstacles(){
    for(const o of obstacles){
      const x=PLAYER_X+o.x-distance;
      if(x>viewW+100||x<-100)continue;
      if(o.type==='block') drawBlock(x);
      else drawSpike(x,o.type==='double');
    }
    // Finish gate slides into view at the end of the circuit.
    const gateX=PLAYER_X+LEVEL_LENGTH-distance+150;
    if(gateX<viewW+150&&gateX>-100){
      ctx.save();ctx.shadowColor='#c8ff4d';ctx.shadowBlur=20;ctx.strokeStyle='#c8ff4d';ctx.lineWidth=3;
      ctx.beginPath();ctx.roundRect(gateX-20,GROUND-105,40,105,19);ctx.stroke();ctx.shadowBlur=0;
      ctx.fillStyle='#ecffc5';ctx.beginPath();ctx.arc(gateX,GROUND-103,4,0,Math.PI*2);ctx.fill();ctx.restore();
    }
  }
  function drawPlayer(t){
    const s=PLAYER_SIZE, cx=PLAYER_X+s/2, cy=y+s/2;
    // Motion trail
    for(let i=trail.length-1;i>=0;i--){const p=trail[i],alpha=(1-p.age/.22)*.22;if(alpha<=0)continue;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rot);ctx.globalAlpha=alpha;ctx.fillStyle='#c8ff4d';ctx.fillRect(-s/2,-s/2,s,s);ctx.restore();}
    ctx.save();ctx.translate(cx,cy);ctx.rotate(rotation);
    ctx.shadowColor='rgba(200,255,77,.68)';ctx.shadowBlur=19;
    const cube=ctx.createLinearGradient(-s/2,-s/2,s/2,s/2);cube.addColorStop(0,'#edffb2');cube.addColorStop(.3,'#c8ff4d');cube.addColorStop(1,'#8dcf38');
    ctx.fillStyle=cube;roundedRect(-s/2,-s/2,s,s,5);ctx.fill();ctx.shadowBlur=0;
    ctx.strokeStyle='rgba(255,255,255,.74)';ctx.lineWidth=1.2;roundedRect(-s/2+4,-s/2+4,s-8,s-8,3);ctx.stroke();
    ctx.fillStyle='rgba(14,22,13,.78)';ctx.fillRect(-8,-5,4,5);ctx.fillRect(5,-5,4,5);
    ctx.fillStyle='rgba(14,22,13,.62)';ctx.fillRect(-5,7,10,2);
    ctx.restore();
    if(toast&&elapsed<toastUntil){ctx.save();ctx.globalAlpha=Math.min(1,(toastUntil-elapsed)*2);ctx.font='500 10px "DM Mono", monospace';ctx.textAlign='center';ctx.fillStyle='#c8ff4d';ctx.shadowColor='#c8ff4d';ctx.shadowBlur=10;ctx.fillText(toast,cx,cy-39);ctx.restore();}
  }
  function drawParticles(){
    for(const p of particles){ctx.globalAlpha=Math.max(0,p.life/(p.maxLife||.55));ctx.fillStyle=p.color;ctx.fillRect(p.x-p.size/2,p.y-p.size/2,p.size,p.size);}
    ctx.globalAlpha=1;
  }
  function draw(t){
    ctx.setTransform(dpr*scale,0,0,dpr*scale,0,0);
    ctx.clearRect(0,0,viewW,viewH);
    drawBackground(t);drawGround(t);drawObstacles();drawPlayer(t);drawParticles();
    if(deathFlash>0){ctx.fillStyle=`rgba(255,83,125,${deathFlash*.14})`;ctx.fillRect(0,0,viewW,viewH);}
  }
  function collide(){
    const left=PLAYER_X+5,right=PLAYER_X+PLAYER_SIZE-5,bottom=y+PLAYER_SIZE-2;
    for(const o of obstacles){
      const x=PLAYER_X+o.x-distance;
      if(o.type==='block'){
        if(right>x+3&&left<x+39&&y+5<GROUND-2&&bottom>GROUND-42)return true;
      } else {
        const count=o.type==='double'?2:1, size=36, gap=5;
        for(let i=0;i<count;i++){
          const sx=x+i*(size+gap), overlapL=Math.max(left,sx), overlapR=Math.min(right,sx+size);
          if(overlapR<=overlapL)continue;
          const center=sx+size/2;
          const nearestX=Math.max(overlapL,Math.min(overlapR,center));
          const surface=GROUND-38*(1-Math.abs(nearestX-center)/(size/2));
          if(bottom>surface-1)return true;
        }
      }
    }
    return false;
  }
  function update(dt,now){
    if(state==='running'){
      elapsed+=dt;distance=elapsed*SPEED;
      const beat=Math.floor(elapsed/BEAT);
      if(beat!==lastBeat){lastBeat=beat;beatSound(beat);}
      if(!grounded){vy+=2150*dt;y+=vy*dt;if(y>=GROUND-PLAYER_SIZE){y=GROUND-PLAYER_SIZE;vy=0;grounded=true;}}
      rotation=grounded?Math.round(rotation/(Math.PI/2))*Math.PI/2:rotation+4.8*dt;
      if(grounded&&Math.random()<dt*17)trail.push({x:PLAYER_X+PLAYER_SIZE/2,y:GROUND-PLAYER_SIZE/2,rot:rotation,age:0});
      if(collide()){die();}
      if(distance>=LEVEL_LENGTH){finish();}
      const pct=distance/LEVEL_LENGTH*100;updateHud(pct);
    } else if(state==='ready'){
      y=GROUND-PLAYER_SIZE+Math.sin(now*.003)*2.5;rotation=0;
    }
    particles=particles.filter(p=>p.life>0);
    for(const p of particles){const step=Math.min(dt,.05);p.life-=step;p.x+=p.vx*step;p.y+=p.vy*step;p.vy+=430*step;}
    trail=trail.filter(p=>p.age<.22);for(const p of trail)p.age+=dt;
    if(deathFlash>0)deathFlash=Math.max(0,deathFlash-dt*1.8);
    const beatTime=state==='running'?elapsed:(now/1000);
    const beatNo=Math.floor(beatTime/BEAT),phase=(beatTime/BEAT)%1;
    beatDots.forEach((dot,i)=>{dot.classList.toggle('active',i===beatNo%4&&phase<.22);});
  }
  function frame(now){
    if(!lastFrame)lastFrame=now;
    const dt=Math.min(.05,Math.max(0,(now-lastFrame)/1000));lastFrame=now;
    update(dt,now);draw(state==='running'?elapsed:now/1000);
    requestAnimationFrame(frame);
  }
  updateHud(0);bestValue.textContent=`${String(best).padStart(2,'0')}%`;
  requestAnimationFrame(frame);
})();
