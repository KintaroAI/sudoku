(() => {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const uid = (() => { let i = 0; return (p="id") => `${p}-${(++i).toString(36)}`; })();
  const create = (tag, attrs={}, parent=null) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k,v] of Object.entries(attrs)) (k==="textContent") ? (el.textContent=v) : el.setAttribute(k, v);
    if (parent) parent.appendChild(el); return el;
  };
  const parseRGB = (str) => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(str);
    return m ? [parseInt(m[1],10), parseInt(m[2],10), parseInt(m[3],10)] : [230,235,240];
  };
  const brighten = ([r,g,b], d=30) => `rgb(${Math.min(255,r+d)},${Math.min(255,g+d)},${Math.min(255,b+d)})`;
  const bPoint = (p0,p1,p2,p3,t)=>{ const u=1-t; return {
    x:(u*u*u)*p0.x + 3*(u*u)*t*p1.x + 3*u*(t*t)*p2.x + (t*t*t)*p3.x,
    y:(u*u*u)*p0.y + 3*(u*u)*t*p1.y + 3*u*(t*t)*p2.y + (t*t*t)*p3.y
  }};
  class Block {
    constructor(diagram, id, x,y,w,h, label, opts = {}){
      this.d=diagram; this.id=id; this.x=x; this.y=y; this.w=w; this.h=h; this.label=label;
      const parent = opts.note ? this.d.gNotes : this.d.gBlocks;
      this.g = create("g", {class:`block${opts.note?' note':''}`,"data-id":id}, parent);
      this.rect = create("rect", {x,y,width:w,height:h,rx:14,ry:14}, this.g);
      this.text = create("text", {"text-anchor":"middle","dominant-baseline":"middle"}, this.g);
      this._renderText(); this._bindDrag();
    }
    _renderText(){
      this.text.replaceChildren();
      const parts = this.label.replace(/<br\/?>/g,"\n").split("\n");
      const lineH=18, totalH=lineH*parts.length;
      const cx = this.x + this.w/2;
      const y0 = (this.y + this.h/2) - (totalH/2) + 12;
      this.text.setAttribute("x", cx); this.text.setAttribute("y", y0);
      parts.forEach((line,i)=>{ const t=document.createElementNS(SVG_NS,"tspan");
        if(i>0) t.setAttribute("dy", lineH); t.setAttribute("x", cx); t.textContent=line; this.text.appendChild(t); });
    }
    anchor(edge,t){ t=clamp(t,-0.5,0.5);
      if(edge==="top"||edge==="bottom"){
        return { x:this.x + this.w/2 + this.w*t, y: edge==="top" ? this.y : this.y+this.h };
      } else {
        return { x: edge==="left"? this.x : this.x+this.w, y: this.y + this.h/2 + this.h*t };
      }
    }
    edgeDir(edge){ return edge==="top"?{x:0,y:-1}:edge==="right"?{x:1,y:0}:edge==="bottom"?{x:0,y:1}:{x:-1,y:0}; }
    edgeDirInto(edge){ const v=this.edgeDir(edge); return {x:-v.x,y:-v.y}; }
    setPos(x,y){
      this.x=x; this.y=y; this.rect.setAttribute("x",x); this.rect.setAttribute("y",y);
      const parts=this.label.replace(/<br\/?>/g,"\n").split("\n"); const lineH=18, totalH=lineH*parts.length;
      const cx=this.x+this.w/2, y0=(this.y+this.h/2)-(totalH/2)+12;
      this.text.setAttribute("x",cx); this.text.setAttribute("y",y0);
      for(const t of this.text.querySelectorAll("tspan")) t.setAttribute("x",cx);
      
      // Update hint positions when block moves
      if (this._hintsEl && this.setHints) {
        // Re-render hints with new position
        const currentHints = this._currentHints || [];
        this.setHints(currentHints);
      }
      
      // Update value text position when block moves
      if (this._valueEl) {
        this._valueEl.setAttribute("x", this.x + this.w/2);
        this._valueEl.setAttribute("y", this.y + this.h/2);
      }
    }
    _bindDrag(){
      let start=null;
      const down=e=>{ 
        const pt = this._clientToSVG(e.clientX, e.clientY);
        start={x:pt.x,y:pt.y,bx:this.x,by:this.y}; 
        this.g.classList.add("dragging"); 
        this.g.setPointerCapture(e.pointerId); 
      };
      const move=e=>{ 
        if(!start) return; 
        const pt = this._clientToSVG(e.clientX, e.clientY);
        this.setPos(start.bx+(pt.x-start.x), start.by+(pt.y-start.y)); 
        this.d.update(); 
        if(this.d.opts.debug) this.d.showDebugInfo(this.x,this.y,this.id); 
      };
      const up  =e=>{ start=null; this.g.classList.remove("dragging"); this.g.releasePointerCapture(e.pointerId); if(this.d.opts.debug) this.d.hideDebugInfo(); };
      this.g.addEventListener("pointerdown",down); this.g.addEventListener("pointermove",move);
      this.g.addEventListener("pointerup",up); this.g.addEventListener("pointercancel",up);
    }
    _clientToSVG(clientX, clientY) {
      const pt = this.d.svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      return pt.matrixTransform(this.d.svg.getScreenCTM().inverse());
    }
  }
  class Connection {
    constructor(diagram, {start,end,color,className,width=3,sparks=0,sparkSpeed=0.8,emitter=false,maxLive=0,emitMult=1.0,outOffset=4,arrow=true}){
      this.d=diagram; this.start=start; this.end=end; this.width=width; this.color=color; this.className=className;
      this.sparks=Math.max(0,sparks); this.sparkSpeed=Math.max(0,sparkSpeed); this.emitter=!!emitter; this.maxLive=maxLive|0; this.emitMult=Math.max(0,emitMult); this.outOffset=outOffset;
      this.live=[]; this.emitAcc=0;
      const pathAttrs = { fill:"none", "stroke-width":width };
      if (arrow !== false) pathAttrs["marker-end"] = `url(#${this.d.ids.arrow})`;
      this.path = create("path", pathAttrs, this.d.gConns);
      // allow either CSS class or color (color may be a palette key)
      if(this.className) this.path.setAttribute("class",this.className);
      if(this.color) {
        const resolved = this.d.resolveColor(this.color);
        if (resolved) this.path.setAttribute("stroke", resolved);
      }
      this.sparkGroup = create("g", {}, this.d.gSparks);
      if(!this.emitter) this.phases=Array.from({length:this.sparks},(_,i)=>i/Math.max(1,this.sparks));
    }
    endpoints(){
      const sb=this.d.blocks[this.start.block], eb=this.d.blocks[this.end.block];
      let p0=sb.anchor(this.start.edge,this.start.t), d0=sb.edgeDir(this.start.edge);
      const dOutStart=sb.edgeDir(this.start.edge);
      p0={x:p0.x + dOutStart.x*this.outOffset, y:p0.y + dOutStart.y*this.outOffset}; // push outside start block
      let p3=eb.anchor(this.end.edge,this.end.t);
      const dOut=eb.edgeDir(this.end.edge), dInto=eb.edgeDirInto(this.end.edge);
      p3={x:p3.x + dOut.x*this.outOffset, y:p3.y + dOut.y*this.outOffset}; // push outside target block
      return {p0,d0,p3,dInto};
    }
    controls(p0,d0,p3,dInto){
      const span=Math.hypot(p3.x-p0.x,p3.y-p0.y);
      const push=Math.min(this.d.const.CONTROL_PUSH_MAX, span*this.d.const.CONTROL_PUSH_RATIO);
      return { c1:{x:p0.x+d0.x*push, y:p0.y+d0.y*push}, c2:{x:p3.x-dInto.x*push, y:p3.y-dInto.y*push} };
    }
    updatePath(){
      const {p0,d0,p3,dInto}=this.endpoints(); const {c1,c2}=this.controls(p0,d0,p3,dInto);
      this.path.setAttribute("d", `M ${p0.x} ${p0.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p3.x} ${p3.y}`);
      this.cached={p0,c1,c2,p3};
    }
    drawSparks(dt,time){
      if(this.sparks<=0||this.sparkSpeed<=0) return;
      if(!this.cached) this.updatePath(); const {p0,c1,c2,p3}=this.cached;
      this.sparkGroup.replaceChildren();
      const r=Math.max(1,Math.floor((this.width+5)/2)); const stroke=getComputedStyle(this.path).stroke;
      if(!this._sparkColor) this._sparkColor=brighten(parseRGB(stroke),30);
      if(!this.emitter){
        for(const phase of this.phases){ const t=(phase+time*this.sparkSpeed)%1; const pt=bPoint(p0,c1,c2,p3,t);
          create("circle",{cx:pt.x,cy:pt.y,r,fill:this._sparkColor},this.sparkGroup); }
        return;
      }
      // Emitter mode: spawn randomly; probability scales with sparks & speed
      // Expected spawns/sec ~= sparks * spark_speed * emitMult
      const rate=Math.max(0,this.sparks*this.sparkSpeed*this.emitMult); this.emitAcc += rate*dt;
      let toSpawn=Math.floor(this.emitAcc); this.emitAcc-=toSpawn; if(Math.random()<this.emitAcc){toSpawn++; this.emitAcc=0;}
      // Respect cap on concurrent live sparks, if any
      while(toSpawn--){ if(this.maxLive && this.live.length>=this.maxLive) break; this.live.push(0.0); }
      // Advance/draw live sparks; remove those that reach t>=1.0
      const next=[]; for(let t of this.live){ t+=this.sparkSpeed*dt; if(t<1){ const pt=bPoint(p0,c1,c2,p3,t);
        create("circle",{cx:pt.x,cy:pt.y,r,fill:this._sparkColor},this.sparkGroup); next.push(t);} } this.live=next;
    }
  }
  class Diagram {
    constructor(container, opts={}){
      this.opts=Object.assign({width:1000,height:720,grid:true,debug:false},opts);
      this.ids={root:uid("diagram"),grid:uid("grid"),arrow:uid("arrow")};
      this.svg = create("svg",{id:this.ids.root,viewBox:`0 0 ${this.opts.width} ${this.opts.height}`,preserveAspectRatio:"xMidYMid meet",width:"100%",height:"100%"},container);
      const defs=create("defs",{},this.svg);
      if(this.opts.grid){ const p=create("pattern",{id:this.ids.grid,width:24,height:24,patternUnits:"userSpaceOnUse"},defs);
        create("path",{d:"M24 0H0V24",fill:"none",stroke:"var(--grid)","stroke-width":"1"},p);
        // Create a large grid rect that covers the entire SVG area
        const gridRect = create("rect",{x:0,y:0,width:"100%", height:"100%", fill:`url(#${this.ids.grid})`},this.svg);
        // Ensure the grid covers the full SVG area by setting a large viewBox
        gridRect.setAttribute("width", "2000");
        gridRect.setAttribute("height", "2000");
        gridRect.setAttribute("x", "-500");
        gridRect.setAttribute("y", "-500"); }
      const marker=create("marker",{id:this.ids.arrow,viewBox:"0 0 10 10",refX:"9",refY:"5",markerWidth:"5",markerHeight:"5",orient:"auto-start-reverse"},defs);
      create("polygon",{points:"0,0 10,5 0,10",fill:"context-stroke"},marker);
      // Paint order (bottom → top):
      // 1) blocks (regular) → 2) connections → 3) sparks → 4) notes (topmost)
      this.gBlocks=create("g",{class:"blocks"},this.svg);       // bottom
      this.gConns =create("g",{class:"connections"},this.svg);  // middle
      this.gSparks=create("g",{class:"sparks"},this.svg);       // above connections
      this.gNotes =create("g",{class:"notes"},this.svg);        // top
      this.blocks={}; this.connections=[]; this._last=performance.now(); this._running=false;
      this.colors={ motor:"rgb(171,71,188)", motor2:"rgb(186,104,200)", sens1:"rgb(77,182,172)", sens2:"rgb(3,169,244)", cereb:"rgb(240,98,146)", basal:"rgb(245,127,23)", thal:"rgb(1,87,155)", olf:"rgb(56,142,60)", arrow:"rgb(230,235,240)" };
      this.const={ CONTROL_PUSH_MAX:320, CONTROL_PUSH_RATIO:0.42 };
      
      // Debug display element
      this.debugDisplay = null;
      if(this.opts.debug) {
        this.debugDisplay = create("text", {
          x: this.opts.width - 20,
          y: 20,
          "text-anchor": "end",
          "dominant-baseline": "hanging",
          fill: "#ff6b6b",
          "font-size": "14px",
          "font-family": "monospace",
          "font-weight": "bold",
          style: "display: none;"
        }, this.svg);
      }
    }
    // palette name → CSS color (else return original string)
    resolveColor(v){
      if(!v) return null;
      if(this.colors[v]) return this.colors[v];
      return v;
    }
    addBlock(id,x,y,w,h,label,opts){ const b=new Block(this,id,x,y,w,h,label,opts); this.blocks[id]=b; return b; }
    block(id){ return this.blocks[id]; }
    connect(opts){ const c=new Connection(this,opts); this.connections.push(c); c.updatePath(); return c; }
    update(){ for(const c of this.connections) c.updatePath(); }
    showDebugInfo(x,y,blockId){ if(this.debugDisplay){ this.debugDisplay.textContent=`${blockId}: (${Math.round(x)}, ${Math.round(y)})`; this.debugDisplay.style.display="block"; } }
    hideDebugInfo(){ if(this.debugDisplay){ this.debugDisplay.style.display="none"; } }
    _tick=(now)=>{ if(!this._running) return; const dt=(now-this._last)/1000; this._last=now; const elapsed=now/1000;
      for(const c of this.connections) c.drawSparks(dt,elapsed); requestAnimationFrame(this._tick); };
    start(){ if(this._running) return; this._running=true; this._last=performance.now(); requestAnimationFrame(this._tick); }
    stop(){ this._running=false; }

    /* -------- JSON loader (schema tolerant) -------- */
    loadFromJSON(json){
      // accepts: JS object, JSON string, or <script type="application/json" id="...">
      let data=json;
      if (typeof json==="string") {
        const el = document.getElementById(json);
        if (el && el.tagName==="SCRIPT") data = JSON.parse(el.textContent);
        else data = JSON.parse(json);
      }
      // blocks: support {blocks:[{id,x,y,w/h,width/height,label/text}]} or {nodes:[...]}
      const blocksArr = data.blocks || data.nodes || [];
      for (const b of blocksArr) {
        this.addBlock(b.id ?? b.name, b.x, b.y, b.w ?? b.width, b.h ?? b.height, b.label ?? b.text ?? "");
      }
      // connections: nested {start:{block,edge,t}, end:{...}} or flat keys
      const connsArr = data.connections || data.edges || data.links || [];
      for (const e of connsArr) {
        const start = e.start || { block: e.start_id ?? e.from ?? e.src ?? e.source,
                                   edge:  e.start_edge ?? e.edge_from ?? "right",
                                   t:     e.start_t ?? e.t_from ?? 0 };
        const end   = e.end   || { block: e.end_id   ?? e.to   ?? e.dst ?? e.target,
                                   edge:  e.end_edge   ?? e.edge_to   ?? "left",
                                   t:     e.end_t   ?? e.t_to   ?? 0 };
        const className = e.className ?? e.class ?? undefined;
        let color = e.color ?? e.stroke;
        if (color && this.colors[color]) color = this.colors[color];
        this.connect({
          start, end,
          width: e.width ?? e.stroke_width ?? 3,
          color,
          className,
          sparks: e.sparks ?? e.spark_count ?? 0,
          sparkSpeed: e.spark_speed ?? e.sparkSpeed ?? 0.8,
          emitter: !!(e.emitter ?? e.random ?? false),
          maxLive: e.max_live ?? e.maxLive ?? 0,
          emitMult: e.emit_mult ?? e.emitMult ?? 1.0,
          outOffset: e.out_offset ?? e.outOffset ?? 4
        });
      }
      this.update();
    }
  }
  window.run_blocks = (containerSelector, callback, options={})=>{
    const container = (typeof containerSelector==="string") ? document.querySelector(containerSelector) : containerSelector;
    if(!container) throw new Error("run_blocks: container not found");
    const diagram=new Diagram(container, options);
    const b = {
      addBlock:(...a)=>diagram.addBlock(...a),
      block:(id)=>diagram.block(id),
      connect:(o)=>diagram.connect(o),
      update:()=>diagram.update(),
      start:()=>diagram.start(),
      stop:()=>diagram.stop(),
      colors:diagram.colors,
      const:diagram.const,
      svg:diagram.svg,
      loadFromJSON:(j)=>diagram.loadFromJSON(j)
    };
    // optional auto-JSON loading via options
    if (options.json) b.loadFromJSON(options.json);
    if (options.jsonScriptId) b.loadFromJSON(options.jsonScriptId);
    if (options.jsonUrl) {
      fetch(options.jsonUrl).then(r=>r.json()).then(obj=>{ b.loadFromJSON(obj); b.update(); }).catch(console.error);
    }
    if (typeof callback==="function") callback(b);
    diagram.start();
    return b;
  };
})();
