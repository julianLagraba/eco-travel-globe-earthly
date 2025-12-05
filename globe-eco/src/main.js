
import * as topojson from 'https://unpkg.com/topojson-client@3?module';

const worldURL        = 'https://unpkg.com/world-atlas@2/countries-110m.json';
const isoNamesURL     = './data/iso_names.csv';                // columnas: name, isoA3
const unifiedDataURL  = './data/OUT/sustainability_index.csv'; // columnas: isoA3, co2_per_gdp, pm25, renewables_elec_pct, protected_land_pct, score

// Selectores ya existentes en tu HTML
const sel = {
  globe:   d3.select('#globe'),
  legend:  d3.select('#legend'),
  tooltip: d3.select('#tooltip'),
  ranking: d3.select('#ranking'), // opcional
};

// ===================== UTILIDADES =====================
const norm = (s) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// Carga CSV detectando delimitador (',' o ';') y aplicando un row parser
async function loadCSVAuto(url, row) {
  const txt = await fetch(url).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status} al leer ${url}`);
    return r.text();
  });
  const firstLine = txt.split(/\r?\n/, 1)[0] || '';
  const delim = (firstLine.includes(';') && !firstLine.includes(',')) ? ';' : ',';
  return d3.dsvFormat(delim).parse(txt, row);
}

// números robustos: coma → punto; vacíos/NA → null
const toNum = (v) => {
  if (v == null) return null;
  const s = String(v).trim().replace(',', '.');
  if (s === '' || s.toLowerCase() === 'na' || s.toLowerCase() === 'null') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// formateadores SIN prefijos SI
const f0 = d3.format('.0f');
const f1 = d3.format('.1f');
const f2 = d3.format('.2f');
const f3 = d3.format('.3f');
const pct = (v) => {
  if (v == null) return '—';
  const x = (v <= 1 && v >= 0) ? v * 100 : v;
  return `${f0(x)}%`;
};
const num = (v, d=2) => (v == null ? '—' : (d===0 ? f0(v) : d===1 ? f1(v) : f2(v)));

// Aliases de nombre del mapa → ISO3 (los que ya usabas)
const ALIASES = new Map([
  ['democratic republic of the congo','COD'], ['dem rep congo','COD'],
  ['republic of the congo','COG'], ['congo','COG'],
  ['cote divoire','CIV'], ['ivory coast','CIV'],
  ['tanzania','TZA'], ['russia','RUS'], ['vietnam','VNM'], ['laos','LAO'],
  ['bolivia','BOL'], ['venezuela','VEN'], ['czechia','CZE'], ['eswatini','SWZ'],
  ['myanmar','MMR'], ['cape verde','CPV'], ['bahamas','BHS'], ['gambia','GMB'],
  ['syrian arab republic','SYR'], ['kyrgyzstan','KGZ'], ['north macedonia','MKD'],
  ['republic of moldova','MDA'], ['korea, republic of','KOR'], ['south korea','KOR'],
  ['korea, democratic peoples republic of','PRK'], ['north korea','PRK'],
  ['iran, islamic republic of','IRN'], ['iran','IRN'],
  ['united states of america','USA'], ['brunei','BRN'],
  ['central african rep','CAF'], ['central african republic','CAF'],
  ['s sudan','SSD'], ['south sudan','SSD'],
  ['eq guinea','GNQ'], ['equatorial guinea','GNQ'],
  ['w sahara','ESH'], ['western sahara','ESH'],
  ['somaliland','SOM'], ['yemen','YEM'], ['egypt','EGY'], ['syria','SYR'],
  ['turkey','TUR'], ['türkiye','TUR'],
  ['macedonia','MKD'], ['bosnia and herz','BIH'], ['bosnia and herzegovina','BIH'],
  ['slovakia','SVK'], ['palestine','PSE'], ['state of palestine','PSE'],
  ['taiwan','TWN'], ['solomon is','SLB'], ['solomon islands','SLB'],
  ['fr s antartic lands','ATF'], ['fr s antarctic lands','ATF'],
  ['french southern antarctic lands','ATF'], ['french southern territories','ATF'],
  ['french southern and antarctic lands','ATF'],
  ['antartica','ATA'], ['antarctica','ATA'],
  ['Islas Malvinas','ARG'], ['falkland islands','FLK'],
  ['dominican rep','DOM'], ['dominican republic','DOM'],
  ['puerto rico','PRI'],
]);

// ===================== APP =====================
(async function init() {
  // 1) Mundo
  const worldTopo = await d3.json(worldURL);
  const countries = topojson.feature(worldTopo, worldTopo.objects.countries);

  // 2) SVG + proyección
  // === Tamaño según el contenedor (#globe), no la ventana ===
function computeCanvasSize() {
  const el = sel.globe.node();

  if (!el) return { width: 600, height: 600 }; // fallback seguro

  const rect = el.getBoundingClientRect();
  const w = rect.width || 600;
  const h = rect.height || 600;

  // mantener cuadrado perfecto, sin pasar de 980px
  const side = Math.min(w, h, 980);
  return { width: side, height: side };
}

let { width, height } = computeCanvasSize();

const projection = d3.geoOrthographic()
  .fitExtent([[10,10],[width-10,height-10]], {type:'Sphere'});
const path = d3.geoPath(projection);
const graticule = d3.geoGraticule10();

sel.globe.selectAll('*').remove();

const svg = sel.globe.append('svg')
  .attr('viewBox', [0, 0, width, height])
  .attr('aria-label', 'Mapa globo interactivo');

/* ========= DEFS: gradiente océano ========= */
const defs = svg.append('defs');

const oceanGradient = defs.append('radialGradient')
  .attr('id', 'ocean-gradient')
  .attr('cx', '50%')
  .attr('cy', '38%')   // luz un poquito hacia arriba
  .attr('r',  '70%');

// centro más turquesa
oceanGradient.append('stop')
  .attr('offset', '0%')
  .attr('stop-color', '#025e83ff');   // celeste océano

// zona media azul intensa
oceanGradient.append('stop')
  .attr('offset', '40%')
  .attr('stop-color', '#004970ff');   // azul más profundo

// del medio al borde se oscurece bastante
oceanGradient.append('stop')
  .attr('offset', '75%')
  .attr('stop-color', '#01345A');   // azul petróleo

// borde casi negro (para contraste con los países claros)
oceanGradient.append('stop')
  .attr('offset', '100%')
  .attr('stop-color', '#000814');   // azul noche

/* ========= Esfera + halo limpio ========= */

// Océano con el gradiente nuevo (sin filtros que lo apaguen)
svg.append('path')
  .datum({ type: 'Sphere' })
  .attr('d', path)
  .attr('fill', 'url(#ocean-gradient)')
  .attr('stroke', '#23C4FF')        // contorno celeste
  .attr('stroke-width', 1.2);


  svg.append('path')
  .datum(graticule)
  .attr('d', path)
  .attr('fill', 'none')
  .attr('stroke', 'rgba(15, 23, 42, 0.45)')
  .attr('stroke-width', 0.35)
  .attr('stroke-dasharray', '1 6');

    // === Responsivo al resize ===
  window.addEventListener('resize', () => {
  const s = computeCanvasSize();
  width = s.width;
  height = s.height;

  svg.attr('viewBox', [0, 0, width, height]);
  projection.fitExtent([[10,10],[width - 10, height - 10]], {type:'Sphere'});
  svg.selectAll('path').attr('d', path);
});

  // 3) Cargar iso_names + TU CSV (auto-delimiter + num parser)
  const [isoRows, uniRows] = await Promise.all([
    loadCSVAuto(isoNamesURL, d => ({ name: d.name, isoA3: (d.isoA3||'').trim() })),
    loadCSVAuto(unifiedDataURL, d => ({
      isoA3: (d.isoA3 ?? d.iso3A ?? d.ISO3 ?? d.code ?? d.iso_code ?? '').trim().toUpperCase(),
      co2_per_capita:       toNum(d.co2_per_capita),
      pm25:                 toNum(d.pm25),
      renewables_elec_pct:  toNum(d.renewables_elec_pct),
      protected_land_pct:   toNum(d.protected_land_pct),
      safe_water_pct:       toNum(d.safe_water_pct),        
      life_expectancy_yrs:  toNum(d.life_expectancy_yrs),   
      hdi:                  toNum(d.hdi),                   
      score:                toNum(d.score),
    })),
  ]);

  console.log('📄 iso_names rows:', isoRows.length);
  console.log('📄 unified rows:', uniRows.length);
  console.log('🔎 ejemplo unified:', uniRows[0]);

  // 4) Mapeos
  const nameToIso = new Map(isoRows.map(r => [norm(r.name), r.isoA3]));
  const getIsoFromFeature = (f) => {
    const n = norm(f?.properties?.name);
    if (!n) return null;
    if (ALIASES.has(n)) return ALIASES.get(n);
    return nameToIso.get(n) ?? null;
  };
  const dataByIso = new Map(uniRows.map(d => [d.isoA3, d]));

  // 5) Color
 /*const COLORS = ['#8B1024', '#E3692C', '#F5D37A', '#B8E07A', '#2F995A'];*/
  const COLORS = ['#0045AD', '#046DC4', '#049AD5', '#00B4CD', '#9CE3FB'];

// === Selector de modo ===
  let mode = "eco"; // "eco" o "sustain"
  const modeSelect = document.createElement("select");
  modeSelect.innerHTML = `
    <option value="eco">🌿 Ecológico puro</option>
    <option value="sustain">🌎 Sostenibilidad integral</option>
  `;
  modeSelect.style = "margin:8px;padding:6px;border-radius:6px;background:#111;color:#eee;border:1px solid #333;";
  document.querySelector("#legend").prepend(modeSelect);

  function getScore(d) {
    return mode === "sustain" ? d.sustainability_score : d.eco_score;
  }
  modeSelect.addEventListener("change", e => {
    mode = e.target.value;
    svg.selectAll("path.country").attr("fill", d => {
      const iso = getIsoFromFeature(d);
      const row = dataByIso.get(iso);
      const s = row ? getScore(row) : null;
      return s != null ? colorScale(s) : "#334155";
    });
  });

  const validScores = uniRows.map(d => d.score).filter(Number.isFinite);
  const sMin = d3.min(validScores) ?? 0;
  const sMax = d3.max(validScores) ?? 1;
  const to01 = v => (sMax > sMin ? (v - sMin) / (sMax - sMin) : null);

  // Escala por cuantiles (5 clases)
  const colorScale = d3.scaleQuantile()
    .domain(validScores.map(to01).filter(v => v != null))
    .range(COLORS);

  // 6) index de features por ISO 
  const featureByIso = new Map();
  countries.features.forEach(f => {
    const iso = getIsoFromFeature(f);
    if (iso) featureByIso.set(iso, f);
  });

  // 7) Pintar países
  svg.append('g').selectAll('path.country')
    .data(countries.features)
    .join('path')
    .attr('class','country')
    .attr('d', path)
    .attr('fill', d => {
    const iso = getIsoFromFeature(d);
    const row = iso ? dataByIso.get(iso) : null;
    const v01 = row ? to01(row.score) : null;
    return (v01 != null) ? colorScale(v01) : '#182535';
  })
    .attr('stroke', 'rgba(15, 23, 42, 0.85)')
    .attr('stroke-width', 0.6)
    .style('mix-blend-mode', 'normal')
    .on('mousemove', (e, d) => {
    const iso = getIsoFromFeature(d);
    const row = iso ? dataByIso.get(iso) : null;

    // Formateadores de porcentaje y números
    const fmtPct = v => v == null ? '—' : `${f0((v <= 1 && v >= 0) ? v * 100 : v)}%`;
    const fmtNum = (v, d=1, suf='') => v == null ? '—' : `${d3.format(`.${d}f`)(v)}${suf}`;

    // Render del tooltip
    sel.tooltip
      .style('opacity', 1)
      .style('position', 'absolute')
      .style('pointer-events', 'none')
      .style('left', (e.pageX + 12) + 'px')
      .style('top', (e.pageY + 12) + 'px')
      .html(`
        <div style="font-weight:600;margin-bottom:6px">
        ${d.properties?.name ?? iso ?? '—'}
      </div>
      <div>EcoScore: <b>${row?.score == null ? '—' : f2(row.score)}</b></div>
      <div>CO₂ pc: <b>${row?.co2_per_capita != null ? num(row.co2_per_capita,2) + ' t/hab' : '—'}</b></div>
      <div>PM2.5: <b>${row ? num(row.pm25,1) + ' µg/m³' : '—'}</b></div>
      <div>Renovables: <b>${row ? pct(row.renewables_elec_pct) : '—'}</b></div>
      <div>Área protegida: <b>${row ? pct(row.protected_land_pct) : '—'}</b></div>
      <div>Agua potable: <b>${row ? pct(row.safe_water_pct) : '—'}</b></div>
      <div>Esperanza de vida: <b>${row?.life_expectancy_yrs != null ? num(row.life_expectancy_yrs,1) + ' años' : '—'}</b></div>
      <div>HDI: <b>${row?.hdi != null ? f3(row.hdi) : '—'}</b></div>
    `);
  })
  .on('mouseleave', () => sel.tooltip.style('opacity', 0));

  // 8) Drag para rotar
  svg.call(
    d3.drag().on('drag', (event) => {
      const r = projection.rotate(); const k = 0.25;
      projection.rotate([r[0] + event.dx * k, r[1] - event.dy * k]);
      svg.selectAll('path').attr('d', path);
    })
  );
  
 // Leyenda con cortes calculados (límites de cuantiles):
  const q = colorScale.quantiles(); // devuelve 4 cortes internos
  const legendStops = [0, ...q, 1];
  sel.legend.html(
    `<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
      ${legendStops.slice(0,5).map((s,i) => `
        <div style="display:flex;align-items:center;gap:8px">
          <span style="display:inline-block;width:16px;height:12px;border-radius:3px;background:${COLORS[i]}"></span>
          <span style="font:12px system-ui">${d3.format('.0%')(s)}</span>
        </div>`).join('')}
    </div>`
  );


  // 10) Ranking 
  if (!sel.ranking.empty()) {
    // ordenar por score desc y tomar top 10 con geometría
    const top10 = uniRows
      .filter(r => Number.isFinite(r.score) && featureByIso.has(r.isoA3))
      .sort((a,b) => d3.descending(a.score, b.score))
      .slice(0,5);

    const nameByIso = new Map(isoRows.map(r => [r.isoA3, r.name]));
    sel.ranking
      .style('background','rgba(255,255,255,0.08)')
      .style('padding','10px 14px')
      .style('border-radius','10px')
      .style('border','1px solid #1f2937')
      .style('font','13px system-ui, sans-serif');

    sel.ranking.html('<div style="margin:0 0 8px;opacity:.9">🌱 Top 10 países (por Score)</div>');
    // Contenedor limpio
    sel.ranking.html('<h3>Top países sustentables</h3><div id="ranking-list"></div>');

    // Insertar tarjetas personalizadas
    const rankingList = d3.select('#ranking-list');

    rankingList.selectAll('div.rank-item')
      .data(top10)
      .join('div')
      .attr('class', d => `rank-item ${d === top10[0] ? 'active' : ''}`)
      .html((d, i) => `
        <div class="pos">${i + 1}.</div>
        <div class="name">${nameByIso.get(d.isoA3) || d.isoA3}</div>
        <div class="val">${f2(d.score)}</div>
        <div class="bar"><span style="width: ${d.score * 100}%;"></span></div>
      `)
      .on('click', (_, d) => focusCountry(d.isoA3));
  }

  
  // === AUTOROTATE =============================
/*let autorotate = true;

// velocidad: grados por segundo (tuneable)
const DEG_PER_SEC = 3.0;
const degPerMs = DEG_PER_SEC / 1000;

// timer que avanza la rotación
let last = Date.now();
d3.timer(() => {
  if (!autorotate) { last = Date.now(); return; }
  const now = Date.now();
  const dt = now - last; last = now;

  const r = projection.rotate();
  projection.rotate([r[0] + dt * degPerMs, r[1], r[2]]);
  svg.selectAll('path').attr('d', path);
});

// Pausar al interactuar; reanudar al salir
svg.on('mouseenter', () => { autorotate = false; });
svg.on('mouseleave', () => { autorotate = true; });

// Integrarlo con tu drag existente
drag
  .on('start', () => { autorotate = false; })
  .on('end',   () => { autorotate = true;  });*/

  // 11) Foco al país
  function focusCountry(iso) {
    const feat = featureByIso.get(iso);
    if (!feat) return;
    const [lon, lat] = d3.geoCentroid(feat);
    const r0 = projection.rotate();
    const r1 = [-lon, -lat];
    d3.select(svg.node()).transition()
      .duration(900)
      .tween('rotate', () => {
        const interp = d3.interpolate(r0, r1);
        return t => {
          projection.rotate(interp(t));
          svg.selectAll('path').attr('d', path);
        };
      });

    svg.selectAll('path.country').classed('active', false);
    svg.selectAll('path.country')
      .filter(d => getIsoFromFeature(d) === iso)
      .classed('active', true)
      .raise();
  }

  // 12) Estilos extra
  const style = document.createElement('style');
  style.textContent = `
    .country.active {
      filter: drop-shadow(0 0 10px rgba(255,255,255,.35)) brightness(1.08);
      stroke: #eaf0f7; stroke-width: 1.5px;
    }
    #globe svg { width: 100%; height: auto; display: block; }
  `;
  document.head.appendChild(style);

 // === ECO SCORE RINGS (donut) ===
  document.querySelectorAll('.score-circle').forEach(el => {
    const pct  = Number(el.dataset.pct) || 0;

    // crear canvas
    const canvas = document.createElement('canvas');
    const size   = 72;
    canvas.width  = size;
    canvas.height = size;

    const ctx    = canvas.getContext('2d');
    const cx     = size / 2;
    const cy     = size / 2;
    const radius = size / 2 - 6;     
    const full   = Math.PI * 2;
    const angle  = (pct / 100) * full;

    // fondo transparente
    ctx.clearRect(0, 0, size, size);

    // TRACK del anillo (gris oscuro)
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';  
    ctx.lineWidth   = 8;                   
    ctx.arc(cx, cy, radius, 0, full);
    ctx.stroke();

    // ARCO de porcentaje (celeste)
    ctx.beginPath();
    ctx.strokeStyle = getComputedStyle(document.documentElement)
                        .getPropertyValue('--grad-from') || '#63DFFF';
    ctx.lineWidth   = 8;
    ctx.lineCap     = 'round';           
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + angle);
    ctx.stroke();

    el.innerHTML = '';

    el.style.position = 'relative';

    // insertar canvas
    el.appendChild(canvas);

    // span del porcentaje centrado
    const label = document.createElement('span');
    label.textContent = `${pct}%`;
    label.className   = 'score-circle-label';
    el.appendChild(label);
  });

  // ----- Ocultar header al hacer scroll (mobile) -----
  (function () {
    const header = document.querySelector("header");
    if (!header) return;

    let lastScroll = window.pageYOffset || document.documentElement.scrollTop;

    window.addEventListener("scroll", function () {
      const current = window.pageYOffset || document.documentElement.scrollTop;
      const goingDown = current > lastScroll;

      if (goingDown && current > 80) {
        header.classList.add("header--hidden");
      } else {
        header.classList.remove("header--hidden");
      }

      lastScroll = current;
    });
  })();

  // Debug útil en consola
  const mappedFeatures = countries.features.filter(f => getIsoFromFeature(f)).length;
  console.log('🌍 features:', countries.features.length, '→ mapeadas a ISO3:', mappedFeatures);
  console.log('📄 iso_names:', isoRows.length, 'filas');
  console.log('📄 unified rows:', uniRows.length, 'filas');
  console.log('✅ scores válidos:', validScores.length, 'rango:', sMin, '→', sMax);
})();

//  NAV MOBILE: menú lateral derecha (abre/cierra) 
function initMobileMenu() {
  const mobileMenu = document.getElementById('mobile-menu');
  if (!mobileMenu) return;

  // Botones que abren / cierran 
  const burgerButtons = document.querySelectorAll('#burger-btn, .mobile-menu__burger');

  function openMenu() {
    mobileMenu.classList.add('is-open');
  }

  function closeMenu() {
    mobileMenu.classList.remove('is-open');
  }

  function toggleMenu(e) {
    e.stopPropagation(); // que no dispare el click global
    if (mobileMenu.classList.contains('is-open')) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  // Click en cualquier hamburguesa → abre / cierra
  burgerButtons.forEach(btn => {
    if (!btn) return;
    btn.addEventListener('click', toggleMenu);
  });

  // Click en cualquier parte FUERA del panel → cierra
  document.addEventListener('click', (e) => {
    if (!mobileMenu.classList.contains('is-open')) return;

    if (mobileMenu.contains(e.target)) return;

    // Si el click fue en el botón de hamburguesa, ya lo maneja toggleMenu
    const isBurger = e.target.closest('#burger-btn, .mobile-menu__burger');
    if (isBurger) return;

    closeMenu();
  });

  // Cerrar con ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMenu();
    }
  });
}

// Ejecutar ahora o cuando termine de cargar el DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMobileMenu);
} else {
  initMobileMenu();
}