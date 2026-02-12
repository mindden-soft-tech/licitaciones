import React, { useState, useMemo, useEffect } from 'react';
import { XMLParser } from 'fast-xml-parser';
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

// CONFIGURACIÓN DE INDEXEDDB
const DB_NAME = 'RadarLicitacionesDB';
const STORE_NAME = 'licitaciones';
const DB_VERSION = 1;

function App() {
  const [todoElBloque, setTodoElBloque] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [soloIT, setSoloIT] = useState(true); 
  const [verFavoritas, setVerFavoritas] = useState(false);
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 12;

  const [orden, setOrden] = useState({ columna: 'Fecha', direccion: 'desc' });

  const [filtros, setFiltros] = useState({
    fecha: '',
    titulo: '',
    organismo: '',
    importeMin: '',
    estado: '' 
  });

  const manejarCambioFiltro = (columna, valor) => {
    setFiltros(prev => ({ ...prev, [columna]: valor }));
    setPaginaActual(1);
  };

  const alternarOrden = (columna) => {
    setOrden(prev => ({
      columna,
      direccion: prev.columna === columna && prev.direccion === 'desc' ? 'asc' : 'desc'
    }));
  };

  const esTecnologiaReal = (titulo, cpv) => {
    if (!cpv) return false;
    const cpvStr = cpv.toString();
    if (cpvStr.startsWith('72')) {
      const tercerDigito = parseInt(cpvStr.charAt(2));
      return tercerDigito >= 1 && tercerDigito <= 9;
    }
    return false;
  };

  // MEJORA: Lógica de mapeo más robusta para capturar estados reales del XML
  const mapearEstado = (codigo) => {
    if (!codigo) return "Pendiente";
    const c = String(codigo).toUpperCase().trim();
    
    // Convocatoria suele ser PUB (Publicada), CONV o simplemente cuando no hay resolución
    if (c.includes("CONV") || c === "PUB") return "Convocatoria";
    
    // Evaluación: códigos EV, EVL o PRE
    if (c.includes("EV") || c.includes("PRE")) return "Evaluación";
    
    // Adjudicada: códigos ADJ
    if (c.includes("ADJ")) return "Adjudicada";
    
    // Formalizada: códigos RES (Resuelta) o cuando ya hay contrato formalizado
    if (c.includes("RES") || c.includes("FOR")) return "Formalizada";
    
    // Anulada
    if (c.includes("ANUL") || c.includes("SUSP")) return "Anulada";
    
    return "Otros";
  };

  useEffect(() => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => {
      const db = e.target.result;
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const getAll = store.getAll();
      getAll.onsuccess = () => setTodoElBloque(getAll.result || []);
    };
  }, []);

  const manejarSubidaArchivo = async (e) => {
    const archivo = e.target.files[0];
    if (!archivo) return;
    setCargando(true);
    const parser = new XMLParser({ ignoreAttributes: false });

    try {
      const zip = await JSZip.loadAsync(archivo);
      let datosAcumulados = [];

      for (const [path, file] of Object.entries(zip.files)) {
        if (path.endsWith('.atom') || path.endsWith('.xml')) {
          const contenido = await file.async("text");
          const xmlJS = parser.parse(contenido);
          const entries = xmlJS.feed?.entry || [];
          const lista = Array.isArray(entries) ? entries : [entries];

          lista.forEach(item => {
            const status = item["cac-place-ext:ContractFolderStatus"];
            const project = status?.["cac:ProcurementProject"];
            const budget = project?.["cac:BudgetAmount"]?.["cbc:TaxExclusiveAmount"];
            const titulo = item.title?.["#text"] || item.title || "Sin título";
            const cpv = project?.["cac:RequiredCommodityClassification"]?.["cbc:ItemClassificationCode"]?.["#text"] 
                      || project?.["cac:RequiredCommodityClassification"]?.["cbc:ItemClassificationCode"];
            
            const estadoRaw = status?.["cbc-place-ext:ContractFolderStatusCode"]?.["#text"] 
                             || status?.["cbc-place-ext:ContractFolderStatusCode"];

            datosAcumulados.push({
              id: item.id?.["#text"] || item.id || Math.random().toString(),
              Fecha: item.updated?.split('T')[0] || "N/A",
              Titulo: String(titulo),
              Organismo: status?.["cac-place-ext:LocatedContractingParty"]?.["cac:Party"]?.["cac:PartyName"]?.["cbc:Name"] || "N/A",
              Importe: parseFloat(budget?.["#text"] || budget || 0),
              Link: item.link?.[0]?.["@_href"] || item.link?.["@_href"] || "#",
              CPV: cpv || "",
              Estado: mapearEstado(estadoRaw),
              esIT: esTecnologiaReal(titulo, cpv),
              favorito: false
            });
          });
        }
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onsuccess = (e) => {
        const db = e.target.result;
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        datosAcumulados.forEach(item => {
            const getReq = store.get(item.id);
            getReq.onsuccess = () => {
                if (getReq.result) {
                    store.put({ ...item, favorito: getReq.result.favorito });
                } else {
                    store.put(item);
                }
            };
        });

        transaction.oncomplete = () => {
          const trans2 = db.transaction(STORE_NAME, 'readonly');
          const store2 = trans2.objectStore(STORE_NAME);
          const getAll = store2.getAll();
          getAll.onsuccess = () => {
              setTodoElBloque(getAll.result);
              setCargando(false);
          };
        };
      };
    } catch (err) {
      console.error(err);
      setCargando(false);
    }
  };

  const alternarFavorito = (id) => {
    const nuevaLista = todoElBloque.map(l => 
      l.id === id ? { ...l, favorito: !l.favorito } : l
    );
    setTodoElBloque(nuevaLista);

    const registroActualizado = nuevaLista.find(l => l.id === id);
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onsuccess = (e) => {
      const db = e.target.result;
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(registroActualizado);
    };
  };

  const borrarBaseDeDatos = () => {
    if (window.confirm("¿Borrar todos los datos locales?")) {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onsuccess = (e) => {
        const db = e.target.result;
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).clear();
        transaction.oncomplete = () => setTodoElBloque([]);
      };
    }
  };

  const exportarExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filtrados);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Licitaciones");
    XLSX.writeFile(wb, "Radar_IT.xlsx");
  };

  const filtrados = useMemo(() => {
    return todoElBloque.filter(l => {
      const cumpleIT = soloIT ? l.esIT : true;
      const cumpleFavorito = verFavoritas ? l.favorito : true;
      const cumpleFecha = (l.Fecha || "").includes(filtros.fecha);
      const cumpleTitulo = (l.Titulo || "").toLowerCase().includes(filtros.titulo.toLowerCase());
      const cumpleOrganismo = (l.Organismo || "").toLowerCase().includes(filtros.organismo.toLowerCase());
      // MEJORA: Comparación más segura
      const cumpleEstado = filtros.estado === '' || String(l.Estado) === String(filtros.estado);
      const cumpleImporte = filtros.importeMin === '' || l.Importe >= parseFloat(filtros.importeMin);
      
      return cumpleIT && cumpleFavorito && cumpleFecha && cumpleTitulo && cumpleOrganismo && cumpleImporte && cumpleEstado;
    }).sort((a, b) => {
      const valA = a[orden.columna] || "";
      const valB = b[orden.columna] || "";
      if (orden.direccion === 'asc') return valA > valB ? 1 : -1;
      return valA < valB ? 1 : -1;
    });
  }, [todoElBloque, soloIT, verFavoritas, filtros, orden]);

  const actuales = filtrados.slice((paginaActual - 1) * registrosPorPagina, paginaActual * registrosPorPagina);
  const totalPaginas = Math.ceil(filtrados.length / registrosPorPagina) || 1;

  const estiloInputFiltro = { width: '100%', marginTop: '8px', padding: '6px', fontSize: '12px', fontWeight: 'normal', border: '1px solid #cbd5e1', borderRadius: '4px', boxSizing: 'border-box', height: '32px' };
  const btnBase = { padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', display: 'inline-flex', alignItems: 'center', gap: '6px', textDecoration: 'none' };

  const colorEstado = (estado) => {
    const est = estado || "Pendiente";
    if (est === "Adjudicada") return { bg: '#dcfce7', text: '#166534', desc: 'Ganador seleccionado' };
    if (est === "Formalizada") return { bg: '#dbeafe', text: '#1e40af', desc: 'Contrato firmado' };
    if (est === "Anulada") return { bg: '#fee2e2', text: '#991b1b', desc: 'Cancelada' };
    if (est === "Evaluación") return { bg: '#fef3c7', text: '#92400e', desc: 'Revisando ofertas' };
    if (est === "Convocatoria") return { bg: '#f3e8ff', text: '#6b21a8', desc: 'Abierta a ofertas' };
    return { bg: '#f1f5f9', text: '#475569', desc: 'Otros estados' };
  };

  return (
    <div style={{ padding: '20px', backgroundColor: '#f8f9fa', minHeight: '100vh', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', background: 'white', padding: '25px', borderRadius: '10px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
        
        {/* CABECERA */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
          <h1 style={{ color: '#2c3e50', fontSize: '24px', margin: 0 }}>💻 Radar Licitaciones IT</h1>
          <div style={{ display: 'flex', gap: '10px' }}>
            <a href="https://www.hacienda.gob.es/es-es/gobiernoabierto/datos%20abiertos/paginas/licitacionescontratante.aspx" target="_blank" rel="noreferrer" style={{ ...btnBase, backgroundColor: '#f39c12', color: 'white' }}>🏛️ Web Hacienda</a>
            <button onClick={borrarBaseDeDatos} style={{ ...btnBase, border: '1px solid #e74c3c', color: '#e74c3c', background: 'none' }}>🗑️ Borrar DB</button>
            <button onClick={exportarExcel} style={{ ...btnBase, backgroundColor: '#27ae60', color: 'white', border: 'none' }}>📊 Excel</button>
            <label style={{ ...btnBase, backgroundColor: '#3498db', color: 'white' }}>
              {cargando ? '⏳ ...' : '📁 Cargar ZIP'}
              <input type="file" onChange={manejarSubidaArchivo} style={{ display: 'none' }} />
            </label>
          </div>
        </div>

        {/* LEYENDA Y BOTONES DE FILTRO RÁPIDO */}
        <div style={{ marginBottom: '25px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '20px', paddingBottom: '15px', borderBottom: '1px solid #eee' }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => { setSoloIT(!soloIT); setPaginaActual(1); }} style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid #007bff', backgroundColor: soloIT ? '#e8f4fd' : 'white', color: '#007bff', cursor: 'pointer', fontWeight: 'bold' }}>
              {soloIT ? '✅ Filtrando IT' : '🔍 Ver Todas las Familias'}
            </button>
            <button onClick={() => { setVerFavoritas(!verFavoritas); setPaginaActual(1); }} style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid #e91e63', backgroundColor: verFavoritas ? '#fce4ec' : 'white', color: '#e91e63', cursor: 'pointer', fontWeight: 'bold' }}>
              {verFavoritas ? '⭐ Viendo Favoritas' : '☆ Ver Favoritas'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', fontSize: '11px' }}>
            <span style={{ fontWeight: 'bold', color: '#64748b', marginRight: '5px' }}>LEYENDA ESTADOS:</span>
            {['Convocatoria', 'Evaluación', 'Adjudicada', 'Formalizada', 'Anulada'].map(est => {
              const info = colorEstado(est);
              return (
                <div key={est} style={{ display: 'flex', alignItems: 'center', gap: '5px', background: info.bg, color: info.text, padding: '4px 8px', borderRadius: '4px', border: `1px solid ${info.text}20` }}>
                  <span style={{ fontWeight: 'bold' }}>{est}:</span> <span>{info.desc}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* TABLA CON FILTROS ALINEADOS */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ padding: '15px', textAlign: 'center', width: '40px' }}>⭐</th>
                
                <th style={{ padding: '15px', textAlign: 'left', width: '140px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }} onClick={() => alternarOrden('Fecha')}>
                      <span>📅 Fecha</span>
                      <span style={{ fontSize: '10px' }}>{orden.columna === 'Fecha' ? (orden.direccion === 'asc' ? '🔼' : '🔽') : '↕️'}</span>
                    </div>
                    <input placeholder="Filtro..." style={estiloInputFiltro} value={filtros.fecha} onChange={e => manejarCambioFiltro('fecha', e.target.value)} />
                  </div>
                </th>

                <th style={{ padding: '15px', textAlign: 'left' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }} onClick={() => alternarOrden('Titulo')}>
                      <span>📄 Título</span>
                      <span style={{ fontSize: '10px' }}>{orden.columna === 'Titulo' ? (orden.direccion === 'asc' ? '🔼' : '🔽') : '↕️'}</span>
                    </div>
                    <input placeholder="Buscar título..." style={estiloInputFiltro} value={filtros.titulo} onChange={e => manejarCambioFiltro('titulo', e.target.value)} />
                  </div>
                </th>

                <th style={{ padding: '15px', textAlign: 'left', width: '220px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }} onClick={() => alternarOrden('Organismo')}>
                      <span>🏛️ Organismo</span>
                      <span style={{ fontSize: '10px' }}>{orden.columna === 'Organismo' ? (orden.direccion === 'asc' ? '🔼' : '🔽') : '↕️'}</span>
                    </div>
                    <input placeholder="Filtrar..." style={estiloInputFiltro} value={filtros.organismo} onChange={e => manejarCambioFiltro('organismo', e.target.value)} />
                  </div>
                </th>

                <th style={{ padding: '15px', textAlign: 'center', width: '160px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center' }}>
                    <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }} onClick={() => alternarOrden('Estado')}>
                      <span>📍 Estado</span>
                      <span style={{ fontSize: '10px' }}>{orden.columna === 'Estado' ? (orden.direccion === 'asc' ? '🔼' : '🔽') : '↕️'}</span>
                    </div>
                    <select style={estiloInputFiltro} value={filtros.estado} onChange={e => manejarCambioFiltro('estado', e.target.value)}>
                      <option value="">Todos</option>
                      <option value="Convocatoria">Convocatoria</option>
                      <option value="Evaluación">Evaluación</option>
                      <option value="Adjudicada">Adjudicada</option>
                      <option value="Formalizada">Formalizada</option>
                      <option value="Anulada">Anulada</option>
                    </select>
                  </div>
                </th>

                <th style={{ padding: '15px', textAlign: 'right', width: '140px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-end' }}>
                    <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }} onClick={() => alternarOrden('Importe')}>
                      <span>💰 Importe</span>
                      <span style={{ fontSize: '10px' }}>{orden.columna === 'Importe' ? (orden.direccion === 'asc' ? '🔼' : '🔽') : '↕️'}</span>
                    </div>
                    <input type="number" placeholder="Min €" style={estiloInputFiltro} value={filtros.importeMin} onChange={e => manejarCambioFiltro('importeMin', e.target.value)} />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {actuales.map(l => (
                <tr key={l.id} style={{ borderBottom: '1px solid #f1f5f9', backgroundColor: l.esIT ? '#f0f9ff' : 'white' }}>
                  <td style={{ padding: '15px', textAlign: 'center' }}>
                    <button onClick={() => alternarFavorito(l.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', filter: l.favorito ? 'none' : 'grayscale(100%)', opacity: l.favorito ? 1 : 0.2 }}>⭐</button>
                  </td>
                  <td style={{ padding: '15px', fontSize: '13px', color: '#475569' }}>{l.Fecha}</td>
                  <td style={{ padding: '15px' }}>
                    <a href={l.Link} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: '#1e40af', fontWeight: '600', fontSize: '14px' }}>
                      {l.esIT && "💻 "}{l.Titulo}
                    </a>
                    {l.CPV && <div style={{ fontSize: '10px', color: '#64748b', marginTop: '4px' }}>CPV: {l.CPV}</div>}
                  </td>
                  <td style={{ padding: '15px', fontSize: '12px', color: '#475569' }}>{l.Organismo}</td>
                  <td style={{ padding: '15px', textAlign: 'center' }}>
                    <span style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '10px', fontWeight: 'bold', backgroundColor: colorEstado(l.Estado).bg, color: colorEstado(l.Estado).text, display: 'inline-block', minWidth: '85px', textTransform: 'uppercase' }}>
                      {l.Estado}
                    </span>
                  </td>
                  <td style={{ padding: '15px', textAlign: 'right', fontWeight: 'bold', fontSize: '14px' }}>
                    {l.Importe > 0 ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(l.Importe) : '---'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtrados.length === 0 && <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8', fontSize: '16px' }}>No hay licitaciones que coincidan con los filtros.</div>}
        </div>

        {/* PAGINACIÓN */}
        <div style={{ marginTop: '25px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '20px' }}>
          <button disabled={paginaActual === 1} onClick={() => setPaginaActual(p => p - 1)} style={{ ...btnBase, border: '1px solid #cbd5e1', backgroundColor: 'white', opacity: paginaActual === 1 ? 0.5 : 1 }}>⬅️ Anterior</button>
          <span style={{ fontSize: '14px', color: '#475569' }}>Página <strong>{paginaActual}</strong> de {totalPaginas}</span>
          <button disabled={paginaActual >= totalPaginas} onClick={() => setPaginaActual(p => p + 1)} style={{ ...btnBase, border: '1px solid #cbd5e1', backgroundColor: 'white', opacity: paginaActual >= totalPaginas ? 0.5 : 1 }}>Siguiente ➡️</button>
        </div>
      </div>
    </div>
  );
}

export default App;