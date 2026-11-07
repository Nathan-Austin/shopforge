/**
 * An in-memory stand-in for the Supabase query builder, for unit tests of
 * the email modules: the calls they make (select with counts, insert,
 * upsert, update, delete, eq/neq/in/is, order, limit, single/maybeSingle)
 * over plain arrays, with the subscriber table's unique email and its
 * generated provider_sync_due. Not imported by the app.
 */

export type Row = Record<string, unknown>;

export class FakeDatabase {
  tables: Record<string, Row[]> = {
    email_subscribers: [],
    email_subscriber_events: [],
    email_audiences: [],
    email_campaigns: [],
    email_templates: [],
    products_public: [],
    discount_codes: []
  };
  private nextId = 1;

  from(table: string) {
    return new FakeQuery(this, table);
  }

  id(): string {
    return `00000000-0000-4000-8000-${String(this.nextId++).padStart(12, '0')}`;
  }

  /** Like the database's generated column. */
  static syncDue(row: Row): boolean {
    if (row.status === 'pending') return false;
    if (!row.provider_synced_at) return true;
    return String(row.updated_at ?? '') > String(row.provider_synced_at);
  }
}

type Op =
  | { kind: 'select' }
  | { kind: 'insert'; rows: Row[]; upsert: boolean; onConflict?: string }
  | { kind: 'update'; patch: Row }
  | { kind: 'delete' };

export class FakeQuery {
  private filters: ((row: Row) => boolean)[] = [];
  private op: Op = { kind: 'select' };
  private shape: 'many' | 'single' | 'maybe' = 'many';
  private wantCount = false;
  private head = false;
  private orderBy: string | null = null;
  private max: number | null = null;

  constructor(
    private db: FakeDatabase,
    private table: string
  ) {}

  select(_columns?: string, options?: { count?: string; head?: boolean }) {
    this.wantCount = Boolean(options?.count);
    this.head = Boolean(options?.head);
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = { kind: 'insert', rows: Array.isArray(rows) ? rows : [rows], upsert: false };
    return this;
  }
  upsert(rows: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.op = { kind: 'insert', rows: Array.isArray(rows) ? rows : [rows], upsert: true, onConflict: options?.onConflict };
    return this;
  }
  update(patch: Row) {
    this.op = { kind: 'update', patch };
    return this;
  }
  delete() {
    this.op = { kind: 'delete' };
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => this.read(row, column) === value);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push((row) => this.read(row, column) !== value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(this.read(row, column)));
    return this;
  }
  is(column: string, value: unknown) {
    this.filters.push((row) => (value === null ? this.read(row, column) == null : this.read(row, column) === value));
    return this;
  }
  ilike() {
    return this;
  }
  order(column: string) {
    this.orderBy = column;
    return this;
  }
  limit(count: number) {
    this.max = count;
    return this;
  }
  range(from: number, to: number) {
    this.max = to - from + 1;
    return this;
  }
  single() {
    this.shape = 'single';
    return this;
  }
  maybeSingle() {
    this.shape = 'maybe';
    return this;
  }
  then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
    return Promise.resolve(this.run()).then(resolve, reject);
  }

  private read(row: Row, column: string): unknown {
    if (this.table === 'email_subscribers' && column === 'provider_sync_due') return FakeDatabase.syncDue(row);
    return row[column];
  }

  private matching(table: Row[]): Row[] {
    let rows = table.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.orderBy) rows = [...rows].sort((a, b) => String(a[this.orderBy as string] ?? '').localeCompare(String(b[this.orderBy as string] ?? '')));
    if (this.max !== null) rows = rows.slice(0, this.max);
    return rows;
  }

  private run(): { data: unknown; error: { code?: string; message: string } | null; count: number | null } {
    const table = this.db.tables[this.table] ?? (this.db.tables[this.table] = []);
    let result: Row[] = [];
    switch (this.op.kind) {
      case 'select':
        result = this.matching(table);
        break;
      case 'insert': {
        for (const input of this.op.rows) {
          // onConflict may name several columns ('locale,provider'), as the
          // audience upsert does. Comparing the whole key matters: matching
          // on one column of a composite would hit the wrong row.
          const key = this.op.onConflict ?? (this.table === 'email_subscribers' ? 'email' : this.table === 'email_audiences' ? 'locale,provider' : null);
          const columns = key ? key.split(',').map((column) => column.trim()).filter(Boolean) : [];
          const clash = columns.length
            ? table.find((row) => columns.every((column) => row[column] === input[column]))
            : undefined;
          if (clash) {
            if (!this.op.upsert) return { data: null, error: { code: '23505', message: 'duplicate key' }, count: null };
            Object.assign(clash, input);
            result.push(clash);
            continue;
          }
          const defaults: Row =
            this.table === 'email_subscribers'
              ? { status: 'pending', consented_at: new Date().toISOString(), updated_at: new Date().toISOString(), confirmation_sent_at: null, confirmed_at: null, unsubscribed_at: null, provider_contact_id: null, provider_locale: null, provider_synced_at: null }
              : this.table === 'email_campaigns'
                ? { status: 'draft', locales: {}, recipient_count: 0, error: null, scheduled_at: null, sent_at: null, template_id: null }
                : {};
          const row = { id: this.db.id(), ...defaults, ...input };
          table.push(row);
          result.push(row);
        }
        break;
      }
      case 'update': {
        result = this.matching(table);
        const patch = this.op.patch;
        for (const row of result) {
          const editable = ['email', 'first_name', 'locale', 'status', 'source', 'consent_text'];
          const isEdit = this.table === 'email_subscribers' && Object.keys(patch).some((key) => editable.includes(key) && patch[key] !== row[key]);
          Object.assign(row, patch);
          if (isEdit) row.updated_at = new Date(Date.now() + 1).toISOString();
        }
        break;
      }
      case 'delete': {
        result = this.matching(table);
        this.db.tables[this.table] = table.filter((row) => !result.includes(row));
        if (this.table === 'email_subscribers') {
          const gone = new Set(result.map((row) => row.id));
          this.db.tables.email_subscriber_events = this.db.tables.email_subscriber_events.filter((event) => !gone.has(event.subscriber_id));
        }
        break;
      }
    }
    const count = this.wantCount ? result.length : null;
    if (this.head) return { data: null, error: null, count };
    if (this.shape === 'many') return { data: result, error: null, count };
    if (this.shape === 'single' && result.length !== 1) return { data: null, error: { message: 'not one row' }, count };
    return { data: result[0] ?? null, error: null, count };
  }
}
