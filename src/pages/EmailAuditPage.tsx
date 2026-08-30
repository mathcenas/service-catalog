import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

interface Account {
  email: string;
  description: string;
  screenshotFile: File | null;
  screenshotPreview: string | null;
  screenshotPath: string | null; // returned by upload service
}

function emptyAccount(): Account {
  return { email: '', description: '', screenshotFile: null, screenshotPreview: null, screenshotPath: null };
}

type PageState = 'loading' | 'invalid' | 'form' | 'submitting' | 'done' | 'error';

export function EmailAuditPage({ token }: { token: string }) {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [clientName, setClientName] = useState('');
  const [tokenId, setTokenId] = useState('');
  const [contactName, setContactName] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([emptyAccount()]);
  const [errorMsg, setErrorMsg] = useState('');
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc('validate_email_audit_token', { p_token: token });
      if (error || !data?.valid) {
        setPageState('invalid');
        return;
      }
      setClientName(data.client_name);
      setTokenId(data.token_id);
      setPageState('form');
    })();
  }, [token]);

  function updateAccount(i: number, patch: Partial<Account>) {
    setAccounts(prev => prev.map((a, idx) => idx === i ? { ...a, ...patch } : a));
  }

  function handleFileChange(i: number, file: File | null) {
    if (!file) return;
    const preview = URL.createObjectURL(file);
    updateAccount(i, { screenshotFile: file, screenshotPreview: preview, screenshotPath: null });
  }

  function addAccount() {
    setAccounts(prev => [...prev, emptyAccount()]);
  }

  function removeAccount(i: number) {
    setAccounts(prev => prev.filter((_, idx) => idx !== i));
  }

  async function uploadScreenshots(): Promise<Account[]> {
    const result: Account[] = [...accounts];
    for (let i = 0; i < result.length; i++) {
      const acc = result[i];
      if (!acc.screenshotFile) continue;

      const form = new FormData();
      form.append('token', token);
      form.append('file', acc.screenshotFile);

      const res = await fetch('/api/upload', { method: 'POST', body: form });
      if (!res.ok) throw new Error(`Error subiendo captura ${i + 1}`);
      const json = await res.json();
      result[i] = { ...acc, screenshotPath: json.path };
    }
    return result;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!contactName.trim()) { setErrorMsg('Ingresá tu nombre.'); return; }
    const validAccounts = accounts.filter(a => a.email.trim());
    if (validAccounts.length === 0) { setErrorMsg('Agregá al menos una casilla de correo.'); return; }

    setErrorMsg('');
    setPageState('submitting');

    try {
      const uploaded = await uploadScreenshots();
      const accountsPayload = uploaded
        .filter(a => a.email.trim())
        .map(a => ({
          email:       a.email.trim(),
          description: a.description.trim(),
          screenshot:  a.screenshotPath || null
        }));

      const { data, error } = await supabase.rpc('submit_email_audit', {
        p_token:    token,
        p_contact:  contactName.trim(),
        p_accounts: accountsPayload
      });

      if (error || !data?.ok) {
        throw new Error(data?.error || error?.message || 'Error al enviar');
      }

      setPageState('done');
    } catch (err: any) {
      setErrorMsg(err.message || 'Ocurrió un error. Intentá de nuevo.');
      setPageState('form');
    }
  }

  // ── Render states ────────────────────────────────────────────

  if (pageState === 'loading') {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <p style={{ color: '#94a3b8' }}>Verificando enlace…</p>
        </div>
      </div>
    );
  }

  if (pageState === 'invalid') {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <h2 style={{ color: '#f87171', marginBottom: 8 }}>Enlace inválido o expirado</h2>
          <p style={{ color: '#94a3b8' }}>
            Este enlace no es válido o ya expiró. Pedí uno nuevo a tu proveedor de IT.
          </p>
        </div>
      </div>
    );
  }

  if (pageState === 'done') {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <h2 style={{ color: '#34d399', marginBottom: 8 }}>¡Gracias!</h2>
          <p style={{ color: '#94a3b8' }}>
            Tu información fue enviada correctamente. Podés cerrar esta página.
          </p>
        </div>
      </div>
    );
  }

  const busy = pageState === 'submitting';

  return (
    <div style={styles.page}>
      <div style={{ ...styles.card, maxWidth: 620 }}>
        <div style={{ marginBottom: 24 }}>
          <p style={{ color: '#64748b', fontSize: 13, marginBottom: 4 }}>{clientName}</p>
          <h1 style={{ color: '#f1f5f9', fontSize: 22, fontWeight: 700, margin: 0 }}>
            Relevamiento de casillas de correo
          </h1>
          <p style={{ color: '#94a3b8', fontSize: 14, marginTop: 8 }}>
            Completá tu nombre y las casillas de correo que usás. Si usás Gmail con POP3 para
            recibir correo del trabajo, adjuntá una captura de esa configuración.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Contact name */}
          <div style={styles.field}>
            <label style={styles.label}>Tu nombre *</label>
            <input
              style={styles.input}
              type="text"
              placeholder="Ej: María García"
              value={contactName}
              onChange={e => setContactName(e.target.value)}
              disabled={busy}
            />
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #1e293b', margin: '20px 0' }} />

          <p style={{ color: '#cbd5e1', fontWeight: 600, marginBottom: 12, fontSize: 14 }}>
            Casillas de correo
          </p>

          {accounts.map((acc, i) => (
            <div key={i} style={styles.accountBlock}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <label style={styles.label}>Dirección de correo *</label>
                  <input
                    style={styles.input}
                    type="email"
                    placeholder="usuario@empresa.com"
                    value={acc.email}
                    onChange={e => updateAccount(i, { email: e.target.value })}
                    disabled={busy}
                  />
                </div>
                {accounts.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeAccount(i)}
                    style={styles.removeBtn}
                    disabled={busy}
                    title="Eliminar"
                  >
                    ✕
                  </button>
                )}
              </div>

              <div style={{ marginTop: 8 }}>
                <label style={styles.label}>Descripción (opcional)</label>
                <input
                  style={styles.input}
                  type="text"
                  placeholder="Ej: casilla principal, ventas, etc."
                  value={acc.description}
                  onChange={e => updateAccount(i, { description: e.target.value })}
                  disabled={busy}
                />
              </div>

              {/* Screenshot */}
              <div style={{ marginTop: 8 }}>
                <label style={styles.label}>
                  Captura de configuración Gmail / POP3 (opcional)
                </label>
                {acc.screenshotPreview ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
                    <img
                      src={acc.screenshotPreview}
                      alt="preview"
                      style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 4, border: '1px solid #334155' }}
                    />
                    <div>
                      <p style={{ color: '#94a3b8', fontSize: 12, margin: 0 }}>
                        {acc.screenshotFile?.name}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          updateAccount(i, { screenshotFile: null, screenshotPreview: null, screenshotPath: null });
                          if (fileRefs.current[i]) fileRefs.current[i]!.value = '';
                        }}
                        style={{ ...styles.removeBtn, marginTop: 4, fontSize: 11 }}
                        disabled={busy}
                      >
                        Cambiar
                      </button>
                    </div>
                  </div>
                ) : (
                  <input
                    ref={el => { fileRefs.current[i] = el; }}
                    style={{ ...styles.input, paddingTop: 6 }}
                    type="file"
                    accept="image/*"
                    onChange={e => handleFileChange(i, e.target.files?.[0] || null)}
                    disabled={busy}
                  />
                )}
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addAccount}
            style={styles.addBtn}
            disabled={busy}
          >
            + Agregar casilla
          </button>

          {errorMsg && (
            <p style={{ color: '#f87171', fontSize: 13, marginTop: 12 }}>{errorMsg}</p>
          )}

          <button type="submit" style={styles.submitBtn} disabled={busy}>
            {busy ? 'Enviando…' : 'Enviar información'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#0f172a',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '40px 16px',
  },
  card: {
    background: '#1e293b',
    borderRadius: 12,
    padding: '32px 28px',
    width: '100%',
    maxWidth: 480,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  },
  field: {
    marginBottom: 16,
  },
  label: {
    display: 'block',
    color: '#94a3b8',
    fontSize: 13,
    marginBottom: 4,
    fontWeight: 500,
  },
  input: {
    width: '100%',
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: 6,
    color: '#f1f5f9',
    fontSize: 14,
    padding: '8px 10px',
    outline: 'none',
    boxSizing: 'border-box',
  },
  accountBlock: {
    background: '#0f172a',
    border: '1px solid #1e3a5f',
    borderRadius: 8,
    padding: '14px 14px',
    marginBottom: 12,
  },
  removeBtn: {
    background: 'transparent',
    border: '1px solid #475569',
    color: '#94a3b8',
    borderRadius: 4,
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: 13,
    marginTop: 20,
  },
  addBtn: {
    background: 'transparent',
    border: '1px dashed #334155',
    color: '#64748b',
    borderRadius: 6,
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: 13,
    width: '100%',
    marginBottom: 8,
  },
  submitBtn: {
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '12px 0',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    width: '100%',
    marginTop: 16,
  },
};
