/**
 * Botons d'exportar i importar CSV d'una secció.
 * Exportar descarrega el que hi ha (amb les mateixes columnes que s'importen: serveix de plantilla).
 * Importar llegeix el fitxer, en mostra una vista prèvia i l'envia al servidor d'una sola vegada.
 */
import { useRef, useState } from 'react';
import { csvRecords, toCsv, type ImportResult } from '@cashless/shared';
import { api, errorMessage } from './api';
import { downloadFile, ErrorBox, Modal } from './ui';

export interface CsvSpec<Row> {
  /** Nom del fitxer, sense extensió. */
  fileName: string;
  /** Columnes, tal com surten a la capçalera del fitxer. */
  header: string[];
  /** Files exportades, en l'ordre de `header`. */
  exportRows: () => (string | number | boolean | null)[][] | Promise<(string | number | boolean | null)[][]>;
  /** Converteix una fila llegida (claus normalitzades) en el que espera l'API. Retorna un missatge si no és vàlida. */
  parse?: (record: Record<string, string>) => Row | string;
  importPath?: string;
  /** Text d'ajuda per a la importació. */
  hint?: string;
}

export function CsvTools<Row>({ spec, onImported }: { spec: CsvSpec<Row>; onImported?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ file: string; rows: Row[]; records: Record<string, string>[]; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const exportCsv = async () => {
    setError(null);
    try {
      const date = new Date().toISOString().slice(0, 10);
      downloadFile(`${spec.fileName}-${date}.csv`, toCsv(spec.header, await spec.exportRows()));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const readFile = async (file: File) => {
    setError(null);
    setDone(null);
    const records = csvRecords(await file.text());
    const rows: Row[] = [];
    const errors: string[] = [];
    records.forEach((record, i) => {
      const parsed = spec.parse!(record);
      if (typeof parsed === 'string') errors.push(`Fila ${i + 2}: ${parsed}`);
      else rows.push(parsed);
    });
    if (records.length === 0) errors.push('El fitxer no té cap fila de dades (la primera fila ha de ser la capçalera).');
    setPreview({ file: file.name, rows, records, errors });
  };

  const send = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<ImportResult>(spec.importPath!, { rows: preview.rows });
      const parts = [`${result.created} creats`, `${result.updated} actualitzats`];
      if (result.unchanged) parts.push(`${result.unchanged} ja hi eren`);
      setDone(`Importació feta: ${parts.join(', ')}.`);
      setPreview(null);
      onImported?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const shownKeys = preview ? Object.keys(preview.records[0] ?? {}) : [];

  return (
    <>
      <div className="toolbar">
        <button type="button" onClick={() => void exportCsv()} title="Descarrega un CSV (s’obre amb l’Excel). Serveix també de plantilla per importar.">
          Exporta
        </button>
        {spec.importPath && spec.parse && (
          <>
            <button type="button" onClick={() => input.current?.click()}>
              Importa…
            </button>
            <input
              ref={input}
              type="file"
              accept=".csv,text/csv,text/plain"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void readFile(file);
              }}
            />
          </>
        )}
      </div>
      {done && <div className="ok">{done}</div>}
      {!preview && <ErrorBox message={error} />}

      {preview && (
        <Modal title={`Importa ${preview.file}`} onClose={() => setPreview(null)}>
          {spec.hint && <p className="muted">{spec.hint}</p>}
          {preview.errors.length > 0 ? (
            <div className="error">
              <strong>Cal corregir el fitxer:</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                {preview.errors.slice(0, 15).map((e) => (
                  <li key={e}>{e}</li>
                ))}
                {preview.errors.length > 15 && <li>… i {preview.errors.length - 15} errors més</li>}
              </ul>
            </div>
          ) : (
            <>
              <p>
                {preview.rows.length} {preview.rows.length === 1 ? 'fila' : 'files'}. Els elements amb un nom que ja existeix s’actualitzaran; la resta
                es crearan.
              </p>
              <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      {shownKeys.map((k) => (
                        <th key={k}>{k.replace(/_/g, ' ')}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.records.slice(0, 50).map((r, i) => (
                      <tr key={i}>
                        {shownKeys.map((k) => (
                          <td key={k}>{k === 'pin' && r[k] ? '••••' : r[k]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.records.length > 50 && <p className="muted">Es mostren les 50 primeres.</p>}
            </>
          )}
          <ErrorBox message={error} />
          <div className="form-actions">
            {preview.errors.length === 0 && (
              <button type="button" className="primary" disabled={busy} onClick={() => void send()}>
                {busy ? 'Important…' : `Importa ${preview.rows.length} ${preview.rows.length === 1 ? 'fila' : 'files'}`}
              </button>
            )}
            <button type="button" onClick={() => setPreview(null)}>
              Cancel·la
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
