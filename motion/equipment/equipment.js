import {
  Scene, PerspectiveCamera, Group, Mesh, CylinderGeometry, TorusGeometry, CircleGeometry,
  MeshStandardMaterial, MeshBasicMaterial, HemisphereLight, DirectionalLight, PointLight,
  CanvasTexture, SRGBColorSpace, Raycaster, Vector2, Vector3,
} from 'three';
import { loadModel, promoteAsset } from '../shared/assets.js?v=entry-first-20261112';
import { bindSurface } from '../shared/surface-input.js';
import { disposeTree } from '../shared/dispose.js';
import { createOrbitState, TURN_SECONDS } from './orbit-state.js';

const IDS = ['tufu', 'zidian', 'teamwear'];
const MODELS = IDS.map(id => new URL(`./assets/${id}.meshopt.glb`, import.meta.url));
const STEP = Math.PI * 2 / 3;

function languageText(element, language) {
  return element?.querySelector(`[data-${language}]`)?.textContent.trim() || element?.textContent.trim() || '';
}

// 读取真实产品DOM，避免维护第二份影片、简介或来源表。
export function readProductItems(section) {
  return IDS.map(id => {
    const article = section.querySelector(`[data-product="${id}"]`);
    if (!article) throw new Error(`Missing equipment product: ${id}`);
    const title = article.querySelector('h3');
    const credit = article.querySelector('.product-credit');
    return { id, animationId: id, article, title: { zh: languageText(title,'zh'), en: languageText(title,'en') },
      sourceUrl: article.dataset.source,
      credit: { zh: languageText(credit,'zh'), en: languageText(credit,'en') },
    };
  });
}

function softShadow() {
  const canvas = document.createElement('canvas'); canvas.width=canvas.height=128;
  const context=canvas.getContext('2d'), gradient=context.createRadialGradient(64,64,3,64,64,64);
  gradient.addColorStop(0,'rgba(0,0,0,.54)'); gradient.addColorStop(.55,'rgba(0,0,0,.20)'); gradient.addColorStop(1,'rgba(0,0,0,0)');
  context.fillStyle=gradient;context.fillRect(0,0,128,128);
  const texture=new CanvasTexture(canvas);texture.colorSpace=SRGBColorSpace;
  return new MeshBasicMaterial({ map:texture, transparent:true, depthWrite:false });
}

export function createEquipment({ host, section, media, readState, invalidate }) {
  const scene=new Scene(), camera=new PerspectiveCamera(38,1,.05,20);
  const root=new Group();root.name='EquipmentExhibition';scene.add(root);
  const orbit=createOrbitState(), items=readProductItems(section), events=new AbortController();
  const raycaster=new Raycaster(), pointer=new Vector2(), projected=new Vector3(), position=new Vector3();
  const mouse={x:0,y:0,known:false};
  const models=IDS.map(() => null), pending=new Map(), failed=new Map();
  const labels=[...section.querySelectorAll('[data-equipment-label]')];
  const status=section.querySelector('[data-equipment-status]');
  const fallback=host.querySelector('.equipment-fallback'), fallbackImages=[...host.querySelectorAll('.equipment-fallback img')];
  const retryButton=document.createElement('button');
  retryButton.type='button';retryButton.className='equipment-retry';retryButton.dataset.equipmentRetry='';retryButton.hidden=true;host.append(retryButton);
  let ready=false, disposed=false, active=false, hovered=false, width=1, height=1;
  let initialized=false, initializing=null, entered=false;
  let renderable=false, renderedBefore=false, renderInterrupted=false, unavailable=false;
  let lastSpinAt=null;
  let selected=0, language='', cameraZ=2.65, selectionPush=0, cameraAnimating=false, pointerEvents=0, taps=0, dragCount=0;
  let lastHit=null, lastMotion=null;
  const on=(target,type,fn,options={}) => target.addEventListener(type,fn,{...options,signal:events.signal});
  const hoverMedia=matchMedia('(hover:hover) and (pointer:fine)');
  const keyboardFocused=() => section.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
  const isBlocked=() => disposed || readState().modalOpen || readState().menuOpen || !active;
  const pauseReasons=() => {
    const state=readState();
    return Object.entries({inactive:!active,rendering:!renderable,hovered,dragging:orbit.inspect().dragging,modal:state.modalOpen,hidden:state.hidden,menu:state.menuOpen,reducedMotion:state.reducedMotion}).filter(([,value])=>value).map(([key])=>key);
  };

  root.add(new HemisphereLight(0xc9d7ff,0x17101c,2.0));
  for (const [color,intensity,position] of [[0xf4f5ff,3.7,[-1.7,2.5,3]],[0x9866ff,3.2,[2,1.4,-1.8]],[0xf38291,1.2,[-2,.5,1.2]]]) {
    const light=new DirectionalLight(color,intensity);light.position.set(...position);root.add(light);
  }
  const underglow=new PointLight(0x713cff,.45,3,2);underglow.position.set(0,.12,.4);root.add(underglow);
  const platform=new Group();platform.name='LowExhibitionPlinth';platform.position.y=.07;root.add(platform);
  const base=new Mesh(new CylinderGeometry(.88,.92,.085,96),new MeshStandardMaterial({color:0x15141d,roughness:.48,metalness:.42}));
  base.position.y=-.035;platform.add(base);
  const top=new Mesh(new CircleGeometry(.865,96),new MeshStandardMaterial({color:0x211e2c,roughness:.48,metalness:.35}));
  top.rotation.x=-Math.PI/2;top.position.y=.009;platform.add(top);
  for(const radius of [.86,.69]) {
    const ring=new Mesh(new TorusGeometry(radius,.0024,6,96),new MeshBasicMaterial({color:radius>.8?0x6f438f:0x342b41}));
    ring.rotation.x=Math.PI/2;ring.position.y=.013;platform.add(ring);
  }
  const shadowMaterial=softShadow(), shadows=IDS.map(() => {
    const shadow=new Mesh(new CircleGeometry(.22,40),shadowMaterial);shadow.rotation.x=-Math.PI/2;shadow.position.y=.086;root.add(shadow);return shadow;
  });

  function syncDescription() {
    const lang=readState().lang === 'en'?'en':'zh';language=lang;
    for(let i=0;i<items.length;i++) {
      items[i].article.hidden=i!==selected;
      section.querySelectorAll(`[data-equipment-select="${items[i].id}"]`).forEach(button => button.setAttribute('aria-pressed',String(i===selected)));
    }
    host.setAttribute('aria-label',lang==='zh'?'华羽装备三维展厅。左右方向键选款，横向拖动观察。':'Huayu 3D equipment. Use left or right arrows to select; drag horizontally to inspect.');
    const itemReady=Boolean(models[selected]);
    section.dataset.equipmentState=itemReady?'ready':failed.has(selected)?'failed':'loading';
    const suffix=unavailable?(lang==='zh'?' · 静态展示':' · Still view'):renderInterrupted?(lang==='zh'?' · 等待三维恢复':' · Restoring 3D'):itemReady?'':failed.has(selected)?(lang==='zh'?' · 暂不可用':' · Unavailable'):(lang==='zh'?' · 加载中':' · Loading');
    if(status) status.textContent=`${selected+1} / 3 · ${items[selected].title[lang]}${suffix}`;
    retryButton.hidden=!failed.has(selected) || unavailable;
    retryButton.textContent=lang==='zh'?'重新加载':'Reload';
    host.dataset.equipmentRenderable=String(renderable);
    for(let i=0;i<fallbackImages.length;i++) fallbackImages[i].hidden=renderable && Boolean(models[i]);
  }

  function selectProduct(id, immediate=readState().reducedMotion) {
    const index=IDS.indexOf(id);if(index<0 || disposed) return;
    lastSpinAt=null;
    selected=index;selectionPush=1;orbit.select(index,immediate || !renderable);syncDescription();pose(0);invalidate();
    if(initialized) void loadProduct(index,0);
  }

  function staticStatus(zh,en) {
    host.removeAttribute('tabindex');
    host.removeAttribute('aria-label');
    if(!status)return;
    status.replaceChildren(...Object.entries({zh,en}).map(([lang,text])=>{
      const span=document.createElement('span');span.dataset[lang]='';span.textContent=text;return span;
    }));
  }

  // renderer无法创建时保留当前选择与原位静帧，产品和影片入口继续可用。
  function showFallback() {
    unavailable=true;renderable=false;active=false;lastSpinAt=null;
    syncDescription();
    pose(0);
    invalidate();
  }

  function hitTest(x,y) {
    if(!ready || !renderable) return null;
    root.updateMatrixWorld(true);camera.updateMatrixWorld(true);
    pointer.set(x,y);raycaster.setFromCamera(pointer,camera);
    const hit=raycaster.intersectObjects(models.filter(Boolean),true)[0];
    if(!hit) return null;
    let object=hit.object;
    while(object && !object.userData.productId) object=object.parent;
    return object?{id:object.userData.productId,mesh:hit.object.name,distance:hit.distance}:null;
  }

  function updateHover() {
    hovered=false;
    if(!ready || !active || !mouse.known || !hoverMedia.matches) return;
    const target=document.elementFromPoint(mouse.x,mouse.y);
    if(!target || !host.contains(target)) return;
    const rect=host.getBoundingClientRect();
    if(!rect.width || !rect.height) return;
    // 只命中商品实体才暂停；展台、网孔空隙和周围DOM不算商品。
    hovered=Boolean(hitTest((mouse.x-rect.left)/rect.width*2-1,1-(mouse.y-rect.top)/rect.height*2));
  }

  function clearHover() { mouse.known=false;hovered=false;invalidate(); }

  const input=bindSurface(host,{isBlocked,invalidate,
    onDragStart() {lastSpinAt=null;orbit.beginDrag();dragCount++;},
    onDrag({dx}) {orbit.drag(dx,width);pointerEvents++;},
    onDragEnd({cancelled}) {lastSpinAt=null;selected=orbit.endDrag(cancelled);if(initialized) void loadProduct(selected,0);syncDescription();invalidate();},
    onTap({x,y}) {taps++;lastHit=hitTest(x,y);if(lastHit) selectProduct(lastHit.id);},
    onKey(event) {
      const next=event.key==='ArrowRight'? (selected+1)%3 : event.key==='ArrowLeft'?(selected+2)%3:event.key==='Home'?0:event.key==='End'?2:null;
      if(next===null) return false;
      selectProduct(IDS[next]);return true;
    },
  });
  on(document,'pointermove',event=>{
    if(event.pointerType!=='mouse') return;
    mouse.x=event.clientX;mouse.y=event.clientY;mouse.known=true;
    if(active) invalidate();
  },{passive:true});
  on(document,'pointerout',event=>{if(event.pointerType==='mouse'&&!event.relatedTarget) clearHover();},{passive:true});
  on(section,'pointermove',()=>{pointerEvents++;},{passive:true});
  on(document,'pointerdown',event=>{if(event.pointerType!=='mouse') clearHover();else invalidate();},{capture:true});
  on(document,'keydown',invalidate,{capture:true});
  on(section,'focusin',invalidate);on(section,'focusout',invalidate);
  on(window,'blur',clearHover);
  on(document,'visibilitychange',()=>{if(document.hidden) clearHover();else invalidate();});
  on(hoverMedia,'change',invalidate);
  on(section,'click',event=>{
    if(event.target.closest('[data-equipment-retry]')) {void loadProduct(selected,0);return;}
    const choice=event.target.closest('[data-equipment-select]');
    if(choice) {selectProduct(choice.dataset.equipmentSelect);return;}
    const film=event.target.closest('[data-product-open]');
    if(film) {
      event.preventDefault();
      const article=film.closest('[data-product]'),item=items.find(item=>item.id===article?.dataset.product);
      if(item) media.openFilm(item,film);
    }
  });

  function pose(dt=0,state=readState()) {
    const angle=orbit.inspect().angle, radius=.65;
    // 同一世界布局按可用宽度后移镜头；窄屏不再切换轨道、产品比例或俯视方向。
    const framing=Math.max(1,1.9/(2*Math.tan(19*Math.PI/180)*camera.aspect)/2.35);
    platform.scale.setScalar(.91);
    if(!hovered && !input.read().dragging) selectionPush*=state.reducedMotion?0:Math.exp(-6*dt);
    const desiredZ=(2.35-.17*selectionPush)*framing;
    cameraZ+= (desiredZ-cameraZ)*(state.reducedMotion?1:1-Math.exp(-6*dt));
    if(dt===0 && (state.reducedMotion || !renderable)) cameraZ=desiredZ;
    cameraAnimating=Math.abs(desiredZ-cameraZ)>.001;
    camera.position.set(0,.39+.55*framing,cameraZ);camera.lookAt(0,.39,0);camera.updateMatrixWorld();
    for(let i=0;i<models.length;i++) {
      const phase=angle+i*STEP, frontness=(Math.cos(phase)+1)/2;
      const model=models[i];
      position.set(Math.sin(phase)*radius,.53,Math.cos(phase)*radius*.58+(i===selected?.09*selectionPush:0));
      const scale=.96*(i===selected?1.03:1);
      if(model) {
        model.position.copy(position);
        // 球服沿轨道移动，+Z正面始终朝向镜头，保留真实衣料体积。
        if(IDS[i]==='teamwear') model.lookAt(camera.position);
        else model.rotation.set(-.035*Math.sin(phase),phase+.11,.035*Math.sin(phase));
        model.scale.setScalar(scale);
      }
      shadows[i].visible=Boolean(model);
      shadows[i].position.set(position.x,.087,position.z);
      shadows[i].scale.setScalar(i===2?1.2:.75);
      const still=fallbackImages[i];
      if(still && (!renderable || !model)) {
        projected.copy(position).project(camera);
        still.style.left=`${(projected.x*.5+.5)*100}%`;still.style.top=`${(-projected.y*.5+.5)*100}%`;
        const productHeight=(i===2?.7:.675)*scale;
        const upper=projected.set(position.x,position.y+productHeight/2,position.z).project(camera).y;
        const lower=projected.set(position.x,position.y-productHeight/2,position.z).project(camera).y;
        still.style.height=`${Math.abs(upper-lower)*50/.83}%`;
        still.style.opacity=String(.55+.45*frontness);still.style.zIndex=String(Math.round(frontness*10));
      }
      const label=labels[i];
      if(label) {
        projected.set(position.x,position.y-.39*scale,position.z).project(camera);
        label.style.left=`${(projected.x*.5+.5)*100}%`;label.style.top=`${(-projected.y*.5+.5)*100}%`;
        label.style.opacity=String(.45+.55*frontness);label.dataset.selected=String(i===selected);
      }
    }
    if(fallback && !renderable) {
      projected.set(0,.07,0).project(camera);
      fallback.style.setProperty('--plinth-top',`${(-projected.y*.5+.5)*100}%`);
      const left=projected.set(-.8,.07,0).project(camera).x;
      const right=projected.set(.8,.07,0).project(camera).x;
      fallback.style.setProperty('--plinth-width',`${(right-left)*50}%`);
      const back=projected.set(0,.07,-.8).project(camera).y;
      const front=projected.set(0,.07,.8).project(camera).y;
      fallback.style.setProperty('--plinth-height',`${Math.abs(front-back)*50}%`);
    }
    root.updateMatrixWorld(true);
  }

  function loadProduct(index,priority) {
    if(disposed || models[index]) return Promise.resolve(models[index]);
    if(pending.has(index)) {
      if(priority===0) promoteAsset(MODELS[index].href,{group:'equipment',kind:'model',priority:-1});
      return pending.get(index);
    }
    failed.delete(index);
    const request=loadModel(MODELS[index].href,{group:'equipment',priority}).then(gltf=>{
      if(disposed) {disposeTree(gltf.scene);return null;}
      const model=new Group();model.name=IDS[index];model.userData.productId=IDS[index];model.add(gltf.scene);
      models[index]=model;root.add(model);pose(0);
      return model;
    }).catch(error=>{
      if(!disposed) failed.set(index,String(error));
      return null;
    }).finally(()=>{
      pending.delete(index);
      if(!disposed) {syncDescription();invalidate();}
    });
    pending.set(index,request);syncDescription();
    return request;
  }

  function init() {
    if(disposed) return Promise.resolve();
    if(initializing) return initializing;
    initialized=true;
    initializing=loadProduct(selected,0).then(()=>{
      if(disposed) return;
      ready=true;
      syncDescription();pose(0);invalidate();
    });
    return initializing;
  }

  function retry() {
    if(disposed) return Promise.resolve();
    if(!initialized) return init();
    const indexes=[...failed.keys()].sort((a,b)=>Number(b===selected)-Number(a===selected));
    return Promise.all(indexes.map(index=>loadProduct(index,index===selected?0:1)));
  }

  async function prepareEntry() {
    if(disposed) throw new Error('装备场景已经释放');
    await init();
    if (!models[selected]) await retry();
    if (!models[selected]) throw new Error('当前装备尚未准备完成');
  }

  function setRenderable(value) {
    const next=Boolean(value) && ready && !disposed;
    if(renderable===next) return;
    renderable=next;lastSpinAt=null;
    if(next) {renderedBefore=true;renderInterrupted=false;unavailable=false;}
    else {renderInterrupted=renderedBefore;hovered=false;input.reset();}
    syncDescription();
    pose(0);
    invalidate();
  }

  ({width,height}=host.getBoundingClientRect());
  camera.aspect=width/height;camera.updateProjectionMatrix();
  syncDescription();
  pose(0);
  return {
    host,scene,camera,selectProduct,showFallback,retry,setRenderable,
    init,prepareEntry,
    isContentReady: () => !disposed && Boolean(models[selected]),
    resize(size) {({width,height}=size);camera.aspect=width/height;camera.updateProjectionMatrix();pose(0);},
    setActive(value) {
      if(value!==active) lastSpinAt=null;
      if(value && !active) {
        if(entered) void retry();
        entered=true;
      }
      active=value;
      if(!active) {input.reset();hovered=false;}
    },
    update(frame) {
      if(language!==frame.state.lang) syncDescription();
      updateHover();
      const state={...frame.state,active:active && renderable,hovered}, dt=state.active?frame.dt:0;
      const orbitState=orbit.inspect();
      const spinning=state.active&&!state.hidden&&!state.modalOpen&&!state.menuOpen&&!state.reducedMotion&&!hovered&&!orbitState.dragging&&!orbitState.settling;
      // 自转使用真实活动时间；吸附、拖动和镜头缓动继续使用runtime截断后的dt。
      const spinDt=spinning&&lastSpinAt!==null?Math.max(0,frame.now-lastSpinAt):0;
      lastSpinAt=spinning?frame.now:null;
      const moving=orbit.update(dt,state,spinDt);
      pose(dt,state);lastMotion={now:frame.now,dt,spinDt,time:frame.time};
      return moving || input.read().dragging || (state.active && !state.reducedMotion && cameraAnimating);
    },
    inspect() {
      return {ready,disposed,active,renderable,renderInterrupted,contentReady:Boolean(models[selected]),failedIds:[...failed.keys()].map(index=>IDS[index]),pendingIds:[...pending.keys()].map(index=>IDS[index]),turnSeconds:TURN_SECONDS,...orbit.inspect(),selectedId:IDS[selected],hovered,keyboardFocused:keyboardFocused(),pauseReasons:pauseReasons(),raw:{...input.read()},pointerEvents,taps,dragCount,lastHit,lastMotion,camera:camera.position.toArray(),models:models.filter(Boolean).map(model=>({id:model.userData.productId,position:model.position.toArray(),rotation:model.rotation.y})),size:{width,height}};
    },
    hitTest,
    dispose() {
      if(disposed)return;
      disposed=true;active=false;renderable=false;lastSpinAt=null;input.dispose();events.abort();disposeTree(root);
      host.dataset.equipmentRenderable='false';fallbackImages.forEach(image=>{image.hidden=false;});retryButton.hidden=true;
      section.dataset.equipmentState='disposed';
      staticStatus('静态产品信息','Static product information');
    },
  };
}
