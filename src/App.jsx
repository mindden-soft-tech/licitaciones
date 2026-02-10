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
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 12;

  const [orden, setOrden] = useState({ columna: 'Fecha', direccion: 'desc' });

  const [filtros, setFiltros] = useState({
    fecha: '',
    titulo: '',
    organismo: '',
    importeMin: ''
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

  // --- FILTRO CPV IT ESTRICTO: 7210... hasta 7290... ---
  const esTecnologiaReal = (titulo, cpv) => {
    if (!cpv) return false;
    const cpvStr = cpv.toString();
    // Verificamos que empiece por 72 y que el cuarto dígito (índice 2) sea >= 1
    // Esto cubre 721, 722, 723, 724, 725, 726, 727, 728, 729
    if (cpvStr.startsWith('72')) {
      const tercerDigito = parseInt(cpvStr.charAt(2));
      return tercerDigito >= 1 && tercerDigito <= 9;
    }
    return false;
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
      getAll.onsuccess = () => setTodoElBloque(getAll.result);
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

            datosAcumulados.push({
              id: item.id?.["#text"] || item.id || Math.random().toString(),
              Fecha: item.updated?.split('T')[0] || "N/A",
              Titulo: titulo,
              Organismo: status?.["cac-place-ext:LocatedContractingParty"]?.["cac:Party"]?.["cac:PartyName"]?.["cbc:Name"] || "N/A",
              Importe: parseFloat(budget?.["#text"] || budget || 0),
              Link: item.link?.[0]?.["@_href"] || item.link?.["@_href"] || "#",
              CPV: cpv || "",
              esIT: esTecnologiaReal(titulo, cpv)
            });
          });
        }
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onsuccess = (e) => {
        const db = e.target.result;
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        datosAcumulados.forEach(item => store.put(item));
        transaction.oncomplete = () => {
          setTodoElBloque(prev => [...datosAcumulados, ...prev]);
          setCargando(false);
        };
      };
    } catch (err) {
      console.error(err);
      setCargando(false);
    }
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
    let resultado = todoElBloque.filter(l => {
      const cumpleIT = soloIT ? l.esIT : true;
      const cumpleFecha = l.Fecha.includes(filtros.fecha);
      const cumpleTitulo = l.Titulo.toLowerCase().includes(filtros.titulo.toLowerCase());
      const cumpleOrganismo = l.Organismo.toLowerCase().includes(filtros.organismo.toLowerCase());
      const cumpleImporte = filtros.importeMin === '' || l.Importe >= parseFloat(filtros.importeMin);
      return cumpleIT && cumpleFecha && cumpleTitulo && cumpleOrganismo && cumpleImporte;
    });

    return resultado.sort((a, b) => {
      const valA = a[orden.columna];
      const valB = b[orden.columna];
      if (orden.direccion === 'asc') return valA > valB ? 1 : -1;
      return valA < valB ? 1 : -1;
    });
  }, [todoElBloque, soloIT, filtros, orden]);

  const actuales = filtrados.slice((paginaActual - 1) * registrosPorPagina, paginaActual * registrosPorPagina);
  const totalPaginas = Math.ceil(filtrados.length / registrosPorPagina);

  const estiloInputFiltro = { width: '100%', marginTop: '8px', padding: '6px', fontSize: '12px', fontWeight: 'normal', border: '1px solid #cbd5e1', borderRadius: '4px', boxSizing: 'border-box' };
  const btnBase = { padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', display: 'inline-flex', alignItems: 'center', gap: '6px', textDecoration: 'none' };

  return (
    <div style={{ padding: '20px', backgroundColor: '#f8f9fa', minHeight: '100vh' }}>
      <div style={{ maxWidth: '1300px', margin: '0 auto', background: 'white', padding: '25px', borderRadius: '10px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
        
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

        <div style={{ marginBottom: '20px' }}>
          <button onClick={() => setSoloIT(!soloIT)} style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid #007bff', backgroundColor: soloIT ? '#e8f4fd' : 'white', color: '#007bff', cursor: 'pointer' }}>
            {soloIT ? '✅ Filtrando IT' : '🔍 Ver Todas las Familias'}
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ padding: '15px', textAlign: 'left', width: '15%' }}>
                  <div style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }} onClick={() => alternarOrden('Fecha')}>
                    <span>📅 Fecha</span>
                    <span>{orden.columna === 'Fecha' ? (orden.direccion === 'asc' ? '🔼' : '🔽') : ''}</span>
                  </div>
                  <input placeholder="Filtrar..." style={estiloInputFiltro} value={filtros.fecha} onChange={e => manejarCambioFiltro('fecha', e.target.value)} />
                </th>
                <th style={{ padding: '15px', textAlign: 'left', width: '45%' }}>
                  <div style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }} onClick={() => alternarOrden('Titulo')}>
                    <span>📄 Título</span>
                    <span>{orden.columna === 'Titulo' ? (orden.direccion === 'asc' ? '🔼' : '🔽') : ''}</span>
                  </div>
                  <input placeholder="Buscar título..." style={estiloInputFiltro} value={filtros.titulo} onChange={e => manejarCambioFiltro('titulo', e.target.value)} />
                </th>
                <th style={{ padding: '15px', textAlign: 'left', width: '25%' }}>
                  <div style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }} onClick={() => alternarOrden('Organismo')}>
                    <span>🏛️ Organismo</span>
                    <span>{orden.columna === 'Organismo' ? (orden.direccion === 'asc' ? '🔼' : '🔽') : ''}</span>
                  </div>
                  <input placeholder="Filtrar organismo..." style={estiloInputFiltro} value={filtros.organismo} onChange={e => manejarCambioFiltro('organismo', e.target.value)} />
                </th>
                <th style={{ padding: '15px', textAlign: 'right', width: '15%' }}>
                  <div style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }} onClick={() => alternarOrden('Importe')}>
                    <span>💰 Importe</span>
                    <span>{orden.columna === 'Importe' ? (orden.direccion === 'asc' ? '🔼' : '🔽') : ''}</span>
                  </div>
                  <input type="number" placeholder="Min €" style={estiloInputFiltro} value={filtros.importeMin} onChange={e => manejarCambioFiltro('importeMin', e.target.value)} />
                </th>
              </tr>
            </thead>
            <tbody>
              {actuales.map(l => (
                <tr key={l.id} style={{ borderBottom: '1px solid #f1f5f9', backgroundColor: l.esIT ? '#f0f9ff' : 'white' }}>
                  <td style={{ padding: '15px', fontSize: '13px' }}>{l.Fecha}</td>
                  <td style={{ padding: '15px' }}>
                    <a href={l.Link} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: '#1e40af', fontWeight: '600' }}>
                      {l.esIT && "💻 "}{l.Titulo}
                    </a>
                    {l.CPV && <div style={{ fontSize: '10px', color: '#64748b', marginTop: '4px' }}>CPV: {l.CPV}</div>}
                  </td>
                  <td style={{ padding: '15px', fontSize: '12px', color: '#475569' }}>{l.Organismo}</td>
                  <td style={{ padding: '15px', textAlign: 'right', fontWeight: 'bold' }}>
                    {l.Importe > 0 ? new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(l.Importe) : '---'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '15px' }}>
          <button disabled={paginaActual === 1} onClick={() => setPaginaActual(p => p - 1)} style={{ ...btnBase, border: '1px solid #ddd', backgroundColor: 'white' }}>Anterior</button>
          <span style={{ fontSize: '14px' }}>Página <strong>{paginaActual}</strong> de {totalPaginas}</span>
          <button disabled={paginaActual >= totalPaginas} onClick={() => setPaginaActual(p => p + 1)} style={{ ...btnBase, border: '1px solid #ddd', backgroundColor: 'white' }}>Siguiente</button>
        </div>
      </div>
    </div>
  );
}

export default App;