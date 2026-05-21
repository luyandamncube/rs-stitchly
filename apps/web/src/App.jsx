import { useEffect, useState } from 'react';
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams
} from 'react-router-dom';
import CanvasWorkspace from './components/CanvasWorkspace';
import { createWorkspace, getSession, getWorkspaceRuns, login, logout } from './lib/api';

const APP_SCREENS = [
  {
    id: 'overview',
    icon: 'O',
    label: 'Overview',
    description: 'Launch workflows, review the product shell, and jump into the canvas.'
  },
  {
    id: 'canvas',
    icon: 'C',
    label: 'Canvas',
    description: 'The main workflow workspace with the current canvas and debug-aware shell.'
  },
  {
    id: 'runs',
    icon: 'R',
    label: 'Runs',
    description: 'Execution history, run lifecycle visibility, and operator-facing activity.'
  },
  {
    id: 'connections',
    icon: 'K',
    label: 'Connections',
    description: 'Reusable source and destination credentials, adapters, and environment bindings.'
  },
  {
    id: 'settings',
    icon: 'S',
    label: 'Settings',
    description: 'Workspace preferences, responsive mode, and shell-level product controls.'
  }
];

const VIEW_MODES = [
  { id: 'desktop', label: 'Desktop' },
  { id: 'mobile', label: 'Mobile' }
];

const VIEW_MODE_STORAGE_KEY = 'stitchly.view-mode.v1';
const SIDEBAR_COLLAPSE_STORAGE_KEY = 'stitchly.dashboard.sidebar-collapsed.v1';
const ATTENTION_COLLAPSE_STORAGE_KEY = 'stitchly.dashboard.attention-collapsed.v1';
const UNAUTHENTICATED_SESSION = {
  authenticated: false,
  workspaces: [],
  active_workspace_id: null,
  user: null
};

export default function App() {
  const [sessionState, setSessionState] = useState({
    status: 'loading',
    session: UNAUTHENTICATED_SESSION
  });
  const [viewMode, setViewMode] = useState(() => readStoredViewMode());
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() =>
    readStoredSidebarCollapsed()
  );
  const [isAttentionCollapsed, setIsAttentionCollapsed] = useState(() =>
    readStoredAttentionCollapsed()
  );

  useEffect(() => {
    void refreshSession(setSessionState);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      SIDEBAR_COLLAPSE_STORAGE_KEY,
      JSON.stringify(isSidebarCollapsed)
    );
  }, [isSidebarCollapsed]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      ATTENTION_COLLAPSE_STORAGE_KEY,
      JSON.stringify(isAttentionCollapsed)
    );
  }, [isAttentionCollapsed]);

  async function handleLogin(email, password) {
    const session = normalizeSession(await login(email, password));
    setSessionState({ status: 'ready', session });
    return session;
  }

  async function handleLogout() {
    await logout();
    setSessionState({ status: 'ready', session: UNAUTHENTICATED_SESSION });
  }

  async function handleRefreshSession() {
    return refreshSession(setSessionState);
  }

  if (sessionState.status === 'loading') {
    return <LoadingScreen />;
  }

  return (
    <BrowserRouter>
      <AppRoutes
        onCreateWorkspaceComplete={handleRefreshSession}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onRefreshSession={handleRefreshSession}
        onToggleAttentionCollapsed={setIsAttentionCollapsed}
        onToggleSidebarCollapsed={setIsSidebarCollapsed}
        isAttentionCollapsed={isAttentionCollapsed}
        isSidebarCollapsed={isSidebarCollapsed}
        session={sessionState.session}
        setViewMode={setViewMode}
        viewMode={viewMode}
      />
    </BrowserRouter>
  );
}

function AppRoutes({
  onCreateWorkspaceComplete,
  onLogin,
  onLogout,
  onRefreshSession,
  onToggleAttentionCollapsed,
  onToggleSidebarCollapsed,
  isAttentionCollapsed,
  isSidebarCollapsed,
  session,
  setViewMode,
  viewMode
}) {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          session.authenticated ? (
            <Navigate replace to={getDefaultAppPath(session)} />
          ) : (
            <LoginRoute onLogin={onLogin} />
          )
        }
      />
      <Route
        path="/workspaces/new"
        element={
          <ProtectedRoute allowEmptyWorkspaces session={session}>
            <CreateWorkspaceRoute
              onCreateWorkspaceComplete={onCreateWorkspaceComplete}
              session={session}
            />
          </ProtectedRoute>
        }
      />
      <Route
        path="/w/:workspaceSlug"
        element={
          <ProtectedRoute session={session}>
            <WorkspaceIndexRedirect session={session} />
          </ProtectedRoute>
        }
      />
      <Route
        path="/w/:workspaceSlug/:screenId"
        element={
          <ProtectedRoute session={session}>
            <WorkspaceScreenRoute
              onLogout={onLogout}
              onRefreshSession={onRefreshSession}
              onToggleAttentionCollapsed={onToggleAttentionCollapsed}
              onToggleSidebarCollapsed={onToggleSidebarCollapsed}
              isAttentionCollapsed={isAttentionCollapsed}
              isSidebarCollapsed={isSidebarCollapsed}
              session={session}
              setViewMode={setViewMode}
              viewMode={viewMode}
            />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate replace to={getDefaultAppPath(session)} />} />
    </Routes>
  );
}

function ProtectedRoute({ allowEmptyWorkspaces = false, children, session }) {
  if (!session.authenticated) {
    return <Navigate replace to="/login" />;
  }

  if (!allowEmptyWorkspaces && !session.workspaces.length) {
    return <Navigate replace to="/workspaces/new" />;
  }

  return children;
}

function WorkspaceIndexRedirect({ session }) {
  const { workspaceSlug } = useParams();
  const workspace = session.workspaces.find((candidate) => candidate.slug === workspaceSlug);

  if (!workspace) {
    return <Navigate replace to={getDefaultAppPath(session)} />;
  }

  return <Navigate replace to={`/w/${workspace.slug}/overview`} />;
}

function WorkspaceScreenRoute({
  onLogout,
  onRefreshSession,
  onToggleAttentionCollapsed,
  onToggleSidebarCollapsed,
  isAttentionCollapsed,
  isSidebarCollapsed,
  session,
  setViewMode,
  viewMode
}) {
  const { screenId, workspaceSlug } = useParams();
  const activeWorkspace = session.workspaces.find((workspace) => workspace.slug === workspaceSlug);

  if (!activeWorkspace) {
    return <Navigate replace to={getDefaultAppPath(session)} />;
  }

  const activeScreen = APP_SCREENS.find((screen) => screen.id === screenId);
  if (!activeScreen) {
    return <Navigate replace to={`/w/${activeWorkspace.slug}/overview`} />;
  }

  return (
    <ProductShell
      activeScreen={activeScreen}
      activeWorkspace={activeWorkspace}
      isAttentionCollapsed={isAttentionCollapsed}
      isSidebarCollapsed={isSidebarCollapsed}
      onLogout={onLogout}
      onRefreshSession={onRefreshSession}
      onToggleAttentionCollapsed={onToggleAttentionCollapsed}
      onToggleSidebarCollapsed={onToggleSidebarCollapsed}
      session={session}
      setViewMode={setViewMode}
      viewMode={viewMode}
    />
  );
}

function ProductShell({
  activeScreen,
  activeWorkspace,
  isAttentionCollapsed,
  isSidebarCollapsed,
  onLogout,
  onRefreshSession,
  onToggleAttentionCollapsed,
  onToggleSidebarCollapsed,
  session,
  setViewMode,
  viewMode
}) {
  const isCanvasRoute = activeScreen.id === 'canvas';
  const [isCanvasSidebarExpanded, setIsCanvasSidebarExpanded] = useState(false);
  const isSidebarCollapsedEffective = isCanvasRoute
    ? !isCanvasSidebarExpanded
    : isSidebarCollapsed;

  useEffect(() => {
    if (isCanvasRoute) {
      setIsCanvasSidebarExpanded(false);
    }
  }, [activeWorkspace.workspace_id, isCanvasRoute]);

  function handleSidebarToggle() {
    if (isCanvasRoute) {
      setIsCanvasSidebarExpanded((current) => !current);
      return;
    }

    onToggleSidebarCollapsed((current) => !current);
  }

  return (
    <div
      className={`dashboard-app dashboard-app--${viewMode}${
        isCanvasRoute ? ' dashboard-app--canvas' : ''
      }${
        isSidebarCollapsedEffective ? ' dashboard-app--sidebar-collapsed' : ''
      }`}
    >
      <div className="dashboard-app__shell">
        <aside
          className={`dashboard-app__sidebar${
            isSidebarCollapsedEffective ? ' dashboard-app__sidebar--collapsed' : ''
          }${isCanvasRoute ? ' dashboard-app__sidebar--overlay' : ''}${
            isCanvasRoute && isSidebarCollapsedEffective
              ? ' dashboard-app__sidebar--overlay-collapsed'
              : ''
          }`}
        >
          <div className="dashboard-sidebar__control-row">
            <button
              aria-label={isSidebarCollapsedEffective ? 'Expand sidebar' : 'Collapse sidebar'}
              className="dashboard-sidebar__collapse-button"
              onClick={handleSidebarToggle}
              type="button"
            >
              <span aria-hidden="true">
                {isSidebarCollapsedEffective ? '↗' : '←'}
              </span>
            </button>
          </div>

          {/* <div className="dashboard-sidebar__brand">
            <span className="dashboard-brand-chip">
              <img
                alt=""
                className="dashboard-brand-chip__symbol"
                src="/brand/symbol/stitchly-symbol-white.svg"
              />
              <span className="dashboard-brand-chip__label">Contained shell</span>
            </span>
            <span className="dashboard-brand-orb" aria-hidden="true">
              <img
                alt=""
                className="dashboard-brand-orb__symbol"
                src="/brand/symbol/stitchly-symbol-white.svg"
              />
            </span>
            <span className="dashboard-brand-name">Stitchly</span>
            <span className="dashboard-brand-label">Operations workspace</span>
          </div> */}

          <div className="dashboard-sidebar__nav">
            <div className="dashboard-nav-group">
              {APP_SCREENS.map((screen) => (
                <NavLink
                  key={screen.id}
                  className={({ isActive }) =>
                    `dashboard-nav-item${isActive ? ' dashboard-nav-item--active' : ''}`
                  }
                  aria-label={screen.label}
                  to={`/w/${activeWorkspace.slug}/${screen.id}`}
                  title={screen.label}
                >
                  <span className="dashboard-nav-item__icon" aria-hidden="true">
                    <DashboardNavIcon screenId={screen.id} />
                  </span>
                  <span className="dashboard-nav-item__label">{screen.label}</span>
                </NavLink>
              ))}
            </div>

            <span className="dashboard-sidebar__rail-divider" aria-hidden="true" />

            <div className="dashboard-sidebar__subnav">
              <button
                aria-label="Refresh session"
                className="dashboard-nav-item dashboard-nav-item--utility"
                onClick={() => void onRefreshSession()}
                title="Refresh session"
                type="button"
              >
                <span className="dashboard-nav-item__icon" aria-hidden="true">
                  <UtilityIcon kind="refresh" />
                </span>
                <span className="dashboard-nav-item__label">Refresh session</span>
              </button>
              <button
                aria-label="Sign out"
                className="dashboard-nav-item dashboard-nav-item--utility"
                onClick={onLogout}
                title="Sign out"
                type="button"
              >
                <span className="dashboard-nav-item__icon" aria-hidden="true">
                  <UtilityIcon kind="logout" />
                </span>
                <span className="dashboard-nav-item__label">Sign out</span>
              </button>
            </div>

            <div
              className={`dashboard-sidebar__utility-card${
                isAttentionCollapsed ? ' dashboard-sidebar__utility-card--collapsed' : ''
              }`}
            >
              <div className="dashboard-sidebar__utility-card-header">
                <span className="dashboard-sidebar__utility-card-title">Attention</span>
                <span className="dashboard-sidebar__utility-card-header-actions">
                  <span className="dashboard-sidebar__utility-card-count">3</span>
                  <button
                    aria-label={isAttentionCollapsed ? 'Expand attention panel' : 'Collapse attention panel'}
                    className="dashboard-sidebar__utility-card-toggle"
                    onClick={() => onToggleAttentionCollapsed((current) => !current)}
                    type="button"
                  >
                    <span aria-hidden="true">{isAttentionCollapsed ? '▾' : '▴'}</span>
                  </button>
                </span>
              </div>

              {isAttentionCollapsed ? (
                <div className="dashboard-sidebar__utility-card-summary">
                  <span>Orders import failed</span>
                  <span>3 active items</span>
                </div>
              ) : (
                <>
                  <div className="dashboard-sidebar__alert">
                    <div className="dashboard-sidebar__alert-title">
                      <span>Orders import failed</span>
                      <span className="dashboard-sidebar__alert-dot" aria-hidden="true" />
                    </div>
                    <div className="dashboard-sidebar__alert-meta">
                      TimeoutError at step 2. Review supplier retries and stale workflow state.
                    </div>
                  </div>

                  <div className="dashboard-sidebar__list">
                    <div className="dashboard-sidebar__mini-item">
                      <span className="dashboard-sidebar__mini-item-label">
                        <span className="dashboard-sidebar__mini-item-dot dashboard-sidebar__mini-item-dot--accent" />
                        <span>Notifications</span>
                      </span>
                      <span className="dashboard-sidebar__mini-item-value">3 new</span>
                    </div>
                    <div className="dashboard-sidebar__mini-item">
                      <span className="dashboard-sidebar__mini-item-label">
                        <span className="dashboard-sidebar__mini-item-dot" />
                        <span>Pending approvals</span>
                      </span>
                      <span className="dashboard-sidebar__mini-item-value">5 items</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="dashboard-sidebar__footer">
            <div className="dashboard-profile">
              <span className="dashboard-profile__avatar dashboard-profile__avatar--symbol">
                <img alt="" src="/brand/symbol/stitchly-symbol-white.svg" />
              </span>
              <span className="dashboard-profile__meta">
                <span className="dashboard-profile__name">
                  {session.user?.display_name ?? 'Builder'}
                </span>
                <span className="dashboard-profile__role">
                  {activeWorkspace.role} · {activeWorkspace.name}
                </span>
              </span>
            </div>
          </div>
        </aside>

        {isCanvasRoute ? (
          <div className="dashboard-canvas-shell">
            <div className="dashboard-canvas-shell__toolbar">
              <span className="dashboard-pill">{activeWorkspace.name}</span>
            </div>
            <main className="dashboard-canvas-shell__stage">
              <CanvasScreen
                isFullScreen
                workspaceId={activeWorkspace.workspace_id}
              />
            </main>
          </div>
        ) : (
          <div className="dashboard-app__main">
            <div className="dashboard-main-card">
              <div className="dashboard-main-card__inner">
                <div className="dashboard-main-card__topbar">
                  <div className="dashboard-main-card__title">
                    <span className="dashboard-main-card__eyebrow">{activeScreen.label}</span>
                    <h1 className="dashboard-main-card__heading">{activeScreen.label}</h1>
                    <span className="dashboard-main-card__subcopy">
                      {activeScreen.description}
                    </span>
                  </div>

                  <div className="dashboard-toolbar">
                    <span className="dashboard-pill">{activeWorkspace.name}</span>
                    <span className="dashboard-pill dashboard-pill--ghost">{session.user?.email}</span>
                    <ViewModeToggle currentMode={viewMode} onSelect={setViewMode} />
                  </div>
                </div>

                <WorkspaceSwitcher
                  activeWorkspace={activeWorkspace}
                  variant="topbar"
                  workspaces={session.workspaces}
                />

                <main className="dashboard-main-card__stage" data-screen={activeScreen.id}>
                  {activeScreen.id === 'overview' ? (
                    <OverviewScreen activeWorkspace={activeWorkspace} viewMode={viewMode} />
                  ) : null}
                  {activeScreen.id === 'runs' ? (
                    <RunsScreen activeWorkspace={activeWorkspace} />
                  ) : null}
                  {activeScreen.id === 'connections' ? <ConnectionsScreen /> : null}
                  {activeScreen.id === 'settings' ? (
                    <SettingsScreen
                      activeWorkspace={activeWorkspace}
                      onSelectViewMode={setViewMode}
                      viewMode={viewMode}
                    />
                  ) : null}
                </main>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function WorkspaceSwitcher({ activeWorkspace, variant = 'sidebar', workspaces }) {
  return (
    <section
      className={`dashboard-workspace-switcher${
        variant === 'topbar' ? ' dashboard-workspace-switcher--topbar' : ''
      }`}
    >
      <div className="dashboard-workspace-switcher__header">
        <span>Workspaces</span>
        <Link to="/workspaces/new">New</Link>
      </div>

      <div className="dashboard-workspace-switcher__list">
        {workspaces.map((workspace) => (
          <Link
            key={workspace.workspace_id}
            className={`dashboard-workspace-link${
              workspace.workspace_id === activeWorkspace.workspace_id ? ' is-active' : ''
            }`}
            to={`/w/${workspace.slug}/overview`}
          >
            <strong>{workspace.name}</strong>
            <span>{workspace.role}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function LoginRoute({ onLogin }) {
  const navigate = useNavigate();
  const [authDraft, setAuthDraft] = useState({
    email: 'builder@stitchly.dev',
    password: 'stitchly'
  });
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const session = await onLogin(authDraft.email, authDraft.password);
      navigate(getDefaultAppPath(session), { replace: true });
    } catch (requestError) {
      setError(requestError.message ?? 'Unable to sign in.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShellLayout>
      <section className="auth-shell__panel auth-brand-panel">
        <div className="auth-brand-panel__guides" aria-hidden="true" />

        <header className="auth-brand-panel__header">
          <div className="auth-wordmark" aria-label="Stitchly brand">
            <span className="auth-wordmark__brand">Stitchly</span>
            <span className="auth-wordmark__label">Workflow Studio</span>
          </div>
        </header>

        <div className="auth-brand-panel__stage">
          <div className="auth-brand-monument" aria-hidden="true">
            <img
              alt=""
              className="auth-brand-monument__symbol"
              src="/brand/symbol/stitchly-symbol-white.svg"
            />
          </div>
        </div>

        <footer className="auth-brand-panel__footer">
          <span>Build and orchestrate AI workflows with clarity.</span>
          <span>Seeded demo access</span>
        </footer>
      </section>

      <section className="auth-shell__panel auth-form-panel">
        <div className="auth-form-card">
          <div className="auth-form-card__topbar">
            <span className="auth-form-card__topmeta">builder@stitchly.dev / stitchly</span>
          </div>

          <div className="auth-form-card__content auth-form-card__content--login">
            <div className="auth-form-card__intro">
              <p className="auth-form-card__eyebrow">Backend session login</p>
              <h1 className="auth-form-card__title">Log in</h1>
              <p className="auth-form-card__summary">
                Real backend sessions are now part of the app shell. Sign in to enter the
                protected workspace routes.
              </p>
            </div>

            <form className="auth-login-form" onSubmit={handleSubmit}>
              <div className="auth-login-form__row">
                <label className="auth-login-field">
                  <span className="auth-login-field__label">Email</span>
                  <span className="auth-login-field__track">
                    <input
                      autoComplete="username"
                      className="auth-login-field__input"
                      onChange={(event) =>
                        setAuthDraft((current) => ({ ...current, email: event.target.value }))
                      }
                      type="email"
                      value={authDraft.email}
                    />
                  </span>
                </label>

                <label className="auth-login-field">
                  <span className="auth-login-field__label">Password</span>
                  <span className="auth-login-field__track auth-login-field__track--password">
                    <input
                      autoComplete="current-password"
                      className="auth-login-field__input auth-login-field__input--password"
                      onChange={(event) =>
                        setAuthDraft((current) => ({
                          ...current,
                          password: event.target.value
                        }))
                      }
                      type="password"
                      value={authDraft.password}
                    />
                    <span aria-hidden="true" className="auth-login-field__icon" />
                  </span>
                </label>
              </div>

              <div className="auth-login-form__helpers">
                <label className="auth-login-check">
                  <input
                    checked={rememberMe}
                    onChange={(event) => setRememberMe(event.target.checked)}
                    type="checkbox"
                  />
                  <span className="auth-login-check__circle" aria-hidden="true" />
                  <span>Remember me</span>
                </label>

                <span className="auth-login-link">Forgot?</span>
              </div>

              {error ? <p className="auth-card__error">{error}</p> : null}

              <div className="auth-login-form__spacer" aria-hidden="true" />

              <button className="auth-form-card__cta" disabled={isSubmitting} type="submit">
                {isSubmitting ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </div>
        </div>
      </section>
    </AuthShellLayout>
  );
}

function CreateWorkspaceRoute({ onCreateWorkspaceComplete, session }) {
  const navigate = useNavigate();
  const [name, setName] = useState('Default Workspace');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (session.workspaces.length > 0) {
      navigate(getDefaultAppPath(session), { replace: true });
    }
  }, [navigate, session]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const response = await createWorkspace(name);
      await onCreateWorkspaceComplete();
      navigate(`/w/${response.workspace.slug}/overview`, { replace: true });
    } catch (requestError) {
      setError(requestError.message ?? 'Unable to create workspace.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-screen__backdrop" />
      <section className="auth-card">
        <div className="auth-card__brand">
          <div className="auth-card__mark">W</div>
          <div>
            <p>Workspace Setup</p>
            <h1>Create your first workspace</h1>
          </div>
        </div>

        <p className="auth-card__summary">
          Workspaces are now real persisted containers for Stitchly. Create one before entering the
          protected app shell.
        </p>

        <form className="auth-card__form" onSubmit={handleSubmit}>
          <label className="shell-field">
            <span>Workspace name</span>
            <input onChange={(event) => setName(event.target.value)} type="text" value={name} />
          </label>

          {error ? <p className="auth-card__error">{error}</p> : null}

          <button className="accent-button accent-button--wide" disabled={isSubmitting} type="submit">
            {isSubmitting ? 'Creating…' : 'Create Workspace'}
          </button>
        </form>
      </section>
    </div>
  );
}

function LoadingScreen() {
  return (
    <AuthShellLayout>
      <section className="auth-shell__panel auth-brand-panel">
        <div className="auth-brand-panel__guides" aria-hidden="true" />
        <header className="auth-brand-panel__header">
          <div className="auth-wordmark">
            <span className="auth-wordmark__brand">Stitchly</span>
            <span className="auth-wordmark__label">Workflow Studio</span>
          </div>
        </header>
        <div className="auth-brand-panel__stage">
          <div className="auth-brand-monument" aria-hidden="true">
            <img
              alt=""
              className="auth-brand-monument__symbol"
              src="/brand/symbol/stitchly-symbol-white.svg"
            />
          </div>
        </div>
      </section>

      <section className="auth-shell__panel auth-form-panel">
        <div className="auth-form-card">
          <div className="auth-form-card__content auth-form-card__content--loading-state">
            <div className="auth-form-card__intro">
              <p className="auth-form-card__eyebrow">Session bootstrap</p>
              <h1 className="auth-form-card__title">Checking session…</h1>
              <p className="auth-form-card__summary">
                Restoring your backend-authenticated Stitchly shell.
              </p>
            </div>
          </div>
        </div>
      </section>
    </AuthShellLayout>
  );
}

function AuthShellLayout({ children }) {
  return (
    <div className="auth-shell-page">
      <div className="auth-shell-page__backdrop" />
      <main className="auth-shell">{children}</main>
    </div>
  );
}

function OverviewScreen({ activeWorkspace, viewMode }) {
  const navigate = useNavigate();

  return (
    <div className="dashboard-overview">
      <div className="dashboard-kpis">
        <div className="dashboard-kpi">
          <span className="dashboard-kpi__label">Workspace</span>
          <span className="dashboard-kpi__value">{activeWorkspace.name}</span>
        </div>
        <div className="dashboard-kpi">
          <span className="dashboard-kpi__label">Shell status</span>
          <span className="dashboard-kpi__value">
            <span className="dashboard-kpi__group">
              <span className="dashboard-kpi__icon dashboard-kpi__icon--success">✓</span>
              <span>Protected</span>
            </span>
          </span>
        </div>
        <div className="dashboard-kpi">
          <span className="dashboard-kpi__label">Viewport mode</span>
          <span className="dashboard-kpi__value">{viewMode}</span>
        </div>
        <div className="dashboard-kpi">
          <span className="dashboard-kpi__label">Next slice</span>
          <span className="dashboard-kpi__value">Persist workflows</span>
        </div>
      </div>

      <div className="dashboard-overview__grid">
        <section className="dashboard-section-card">
          <div className="dashboard-section-card__header">
            <span className="dashboard-section-card__eyebrow">Launch</span>
            <h2>Start in the canvas</h2>
            <p>
              Jump into the current workflow workspace and keep iterating on node, edge, and shell
              behavior.
            </p>
          </div>
          <div className="dashboard-section-card__actions">
            <button
              className="accent-button"
              onClick={() => navigate(`/w/${activeWorkspace.slug}/canvas`)}
              type="button"
            >
              Open Canvas
            </button>
          </div>
        </section>

        <section className="dashboard-section-card">
          <div className="dashboard-section-card__header">
            <span className="dashboard-section-card__eyebrow">Platform</span>
            <h2>Real shell is now active</h2>
            <p>
              This workspace lives behind backend session checks and URL-driven routing instead of
              local-only gate state.
            </p>
          </div>
          <SimpleList
            items={[
              'Backend-owned session bootstrap',
              'Protected workspace routes',
              'Persisted workspace membership',
              'Real login, logout, and workspace creation'
            ]}
          />
        </section>

        <section className="dashboard-section-card">
          <div className="dashboard-section-card__header">
            <span className="dashboard-section-card__eyebrow">Next</span>
            <h2>Natural follow-on work</h2>
            <p>
              Now that the shell is real, we can connect workflow save/load and runs to the active
              workspace.
            </p>
          </div>
          <SimpleList
            items={[
              'Persist workflow definitions by workspace',
              'Route the runs screen to backend workspace data',
              'Add workspace switch persistence',
              'Introduce detail routes and shareable deep links'
            ]}
          />
        </section>
      </div>
    </div>
  );
}

function CanvasScreen({ isFullScreen = false, viewMode = 'desktop', workspaceId }) {
  const viewportVariant = isFullScreen ? 'canvas-route' : viewMode;

  return (
    <div
      className={`workspace-stage workspace-stage--${isFullScreen ? 'canvas-route' : viewMode}`}
    >
      <div className={`workspace-stage__viewport workspace-stage__viewport--${viewportVariant}`}>
        <CanvasWorkspace workspaceId={workspaceId} />
      </div>
    </div>
  );
}

function RunsScreen({ activeWorkspace }) {
  const [runState, setRunState] = useState({
    error: '',
    runs: [],
    status: 'loading'
  });

  useEffect(() => {
    let cancelled = false;

    async function loadRuns() {
      try {
        const response = await getWorkspaceRuns(activeWorkspace.workspace_id);
        if (!cancelled) {
          setRunState({
            error: '',
            runs: response.runs ?? [],
            status: 'ready'
          });
        }
      } catch (error) {
        if (!cancelled) {
          setRunState({
            error: error.message ?? 'Unable to load runs.',
            runs: [],
            status: 'error'
          });
        }
      }
    }

    void loadRuns();
    const intervalId = window.setInterval(() => {
      void loadRuns();
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeWorkspace.workspace_id]);

  const metrics = summarizeWorkspaceRuns(runState.runs);

  return (
    <div className="dashboard-runs">
      <div className="dashboard-toolbar">
        <span className="dashboard-pill">All</span>
        <span className="dashboard-pill dashboard-pill--ghost">{metrics.succeeded} Success</span>
        <span className="dashboard-pill dashboard-pill--ghost">{metrics.failed} Failed</span>
        <span className="dashboard-pill dashboard-pill--ghost">{metrics.running} In progress</span>
        <span className="dashboard-pill">{activeWorkspace.name}</span>
        <span className="dashboard-pill">Last sync</span>
        <span className="dashboard-pill">{humanizeRunLoadState(runState.status)}</span>
        <span className="dashboard-pill dashboard-pill--ghost dashboard-toolbar__search">
          <span>{runState.status === 'loading' ? 'Loading runs…' : 'Workspace runs'}</span>
          <span>{runState.runs.length}</span>
        </span>
      </div>

      <div className="dashboard-kpis">
        <div className="dashboard-kpi">
          <span className="dashboard-kpi__label">Total runs</span>
          <span className="dashboard-kpi__value">
            <span>{metrics.total}</span>
            <span className="dashboard-kpi__divider">|</span>
            <span className="dashboard-kpi__group">
              <span className="dashboard-kpi__icon dashboard-kpi__icon--success">✓</span>
              <span>{metrics.succeeded}</span>
            </span>
            <span className="dashboard-kpi__group">
              <span className="dashboard-kpi__icon dashboard-kpi__icon--running">•</span>
              <span>{metrics.running}</span>
            </span>
            <span className="dashboard-kpi__group">
              <span className="dashboard-kpi__icon dashboard-kpi__icon--failed">×</span>
              <span>{metrics.failed}</span>
            </span>
          </span>
        </div>
        <div className="dashboard-kpi">
          <span className="dashboard-kpi__label">Workflow success</span>
          <span className="dashboard-kpi__value">
            <span>{metrics.successRate}</span>
            <span className="dashboard-kpi__group">
              <span className="dashboard-kpi__icon dashboard-kpi__icon--success">↗</span>
              <span className="dashboard-kpi__delta dashboard-kpi__delta--up">
                {metrics.completedRuns} done
              </span>
            </span>
          </span>
        </div>
        <div className="dashboard-kpi">
          <span className="dashboard-kpi__label">Running now</span>
          <span className="dashboard-kpi__value">{metrics.running}</span>
        </div>
        <div className="dashboard-kpi">
          <span className="dashboard-kpi__label">Avg duration</span>
          <span className="dashboard-kpi__value">{metrics.averageDuration}</span>
        </div>
      </div>

      {runState.status === 'error' ? (
        <section className="dashboard-section-card">
          <div className="dashboard-section-card__header">
            <span className="dashboard-section-card__eyebrow">Runs</span>
            <h2>Unable to load workspace runs</h2>
            <p>{runState.error}</p>
          </div>
        </section>
      ) : null}

      {runState.status === 'ready' && !runState.runs.length ? (
        <section className="dashboard-section-card">
          <div className="dashboard-section-card__header">
            <span className="dashboard-section-card__eyebrow">Runs</span>
            <h2>No runs for this workspace yet</h2>
            <p>
              Execute a workflow from the canvas to create the first workspace-scoped run entry.
            </p>
          </div>
        </section>
      ) : null}

      {runState.runs.length ? (
        <div className="dashboard-table-shell">
        <div className="dashboard-table-header">
          <span className="dashboard-table-header__lead">
            <span className="dashboard-table-check dashboard-table-check--header" aria-hidden="true" />
            <span>Run ID</span>
          </span>
          <span>Started</span>
          <span>Workflow</span>
          <span>Duration</span>
          <span>Status</span>
          <span>Error</span>
          <span>Errors / Retries</span>
        </div>

        {runState.runs.map((run) => {
          const statusTone = dashboardStatusTone(run.status);
          const duration = formatRunDuration(run);
          const started = formatRunTimestamp(run.started_at);
          const error = run.error?.message ?? 'None';
          const retryCount = countRunRetries(run);
          const errorCount = countRunErrors(run);

          return (
            <div className="dashboard-table-row" key={run.run_id}>
            <span className="dashboard-table-row__lead">
              <span className="dashboard-table-check" aria-hidden="true" />
              <span>{shortRunId(run.run_id)}</span>
            </span>
            <span className="dashboard-cell--muted">{started}</span>
            <span className="dashboard-cell--truncate">{run.workflow_id}</span>
            <span>{duration}</span>
            <span className={`dashboard-status dashboard-status--${statusTone}`}>
              <span className={`dashboard-status__dot dashboard-status__dot--${statusTone}`}>
                {statusTone === 'success' ? '✓' : statusTone === 'failed' ? '×' : 'i'}
              </span>
              {humanizeRunStatus(run.status)}
            </span>
            <span className={error === 'None' ? 'dashboard-cell--muted' : 'dashboard-cell--truncate'}>
              {error}
            </span>
            <span>{`${errorCount} / ${retryCount}`}</span>
          </div>
          );
        })}
      </div>
      ) : null}
    </div>
  );
}

function ConnectionsScreen() {
  return (
    <div className="dashboard-overview__grid">
      <section className="dashboard-section-card">
        <div className="dashboard-section-card__header">
          <span className="dashboard-section-card__eyebrow">Connections</span>
          <h2>Connection management scaffold</h2>
          <p>
            This screen gives us a future home for secure references, adapter capabilities, and
            environment-specific bindings.
          </p>
        </div>
        <SimpleList
          items={[
            'Warehouse and database connections',
            'Object store and file staging targets',
            'Notification channel destinations',
            'Capability and permission summaries'
          ]}
        />
      </section>

      <section className="dashboard-section-card">
        <div className="dashboard-section-card__header">
          <span className="dashboard-section-card__eyebrow">Security</span>
          <h2>Frontend-safe surface</h2>
          <p>
            The UI here should only show safe metadata and references. Secrets stay in the backend
            and never enter browser state.
          </p>
        </div>
        <MetricGrid
          items={[
            { label: 'Secrets', value: 'Backend only' },
            { label: 'Refs', value: 'Visible' },
            { label: 'Adapters', value: 'Planned' }
          ]}
        />
      </section>
    </div>
  );
}

function SettingsScreen({ activeWorkspace, onSelectViewMode, viewMode }) {
  return (
    <div className="dashboard-overview__grid">
      <section className="dashboard-section-card">
        <div className="dashboard-section-card__header">
          <span className="dashboard-section-card__eyebrow">Responsive</span>
          <h2>Viewport mode</h2>
          <p>
            The shell can now switch between desktop and mobile preview modes. This is still a
            scaffold for the responsive pass, not the final mobile UX.
          </p>
        </div>
        <ViewModeToggle currentMode={viewMode} onSelect={onSelectViewMode} />
      </section>

      <section className="dashboard-section-card">
        <div className="dashboard-section-card__header">
          <span className="dashboard-section-card__eyebrow">Workspace</span>
          <h2>Current workspace</h2>
          <p>
            Workspaces are now persisted in the backend and attached to the authenticated session.
          </p>
        </div>
        <MetricGrid
          items={[
            { label: 'Name', value: activeWorkspace.name },
            { label: 'Slug', value: activeWorkspace.slug },
            { label: 'Role', value: activeWorkspace.role }
          ]}
        />
      </section>
    </div>
  );
}

function ScreenPanel({ actions = null, children, description, eyebrow, title }) {
  return (
    <section className="screen-panel">
      <div className="screen-panel__header">
        <p>{eyebrow}</p>
        <h2>{title}</h2>
        <span>{description}</span>
      </div>

      <div className="screen-panel__body">{children}</div>

      {actions ? <div className="screen-panel__actions">{actions}</div> : null}
    </section>
  );
}

function MetricGrid({ items }) {
  return (
    <div className="screen-metric-grid">
      {items.map((item) => (
        <div key={item.label} className="screen-metric">
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}

function SimpleList({ items }) {
  return (
    <ul className="screen-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function ViewModeToggle({ currentMode, onSelect }) {
  return (
    <div className="view-mode-toggle" role="group" aria-label="Viewport mode">
      {VIEW_MODES.map((mode) => (
        <button
          key={mode.id}
          className={`view-mode-toggle__button${currentMode === mode.id ? ' is-active' : ''}`}
          onClick={() => onSelect(mode.id)}
          type="button"
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}

function DashboardNavIcon({ screenId }) {
  switch (screenId) {
    case 'overview':
      return (
        <svg viewBox="0 0 18 18" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
          <circle cx="4" cy="4" r="2.2" />
          <circle cx="14" cy="4" r="2.2" />
          <circle cx="4" cy="14" r="2.2" />
          <circle cx="14" cy="14" r="2.2" />
        </svg>
      );
    case 'canvas':
      return (
        <svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
          <circle cx="4" cy="4.2" r="2.1" fill="currentColor" />
          <circle cx="14" cy="13.8" r="2.1" fill="currentColor" />
          <path d="M6.7 4.2H10.7C12.1 4.2 13.2 5.3 13.2 6.7C13.2 8.1 12.1 9.2 10.7 9.2H7.3C5.9 9.2 4.8 10.3 4.8 11.7C4.8 13.1 5.9 14.2 7.3 14.2H11.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.9" />
        </svg>
      );
    case 'runs':
      return (
        <svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
          <circle cx="4" cy="13.8" r="2.1" fill="currentColor" />
          <circle cx="14" cy="4.2" r="2.1" fill="currentColor" />
          <path d="M6.7 13.8H10.7C12.1 13.8 13.2 12.7 13.2 11.3C13.2 9.9 12.1 8.8 10.7 8.8H7.3C5.9 8.8 4.8 7.7 4.8 6.3C4.8 4.9 5.9 3.8 7.3 3.8H11.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.95" />
        </svg>
      );
    case 'connections':
      return (
        <svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
          <circle cx="9" cy="9" r="2.5" fill="currentColor" />
          <circle cx="9" cy="9" r="6.3" stroke="currentColor" strokeWidth="1.8" strokeDasharray="2.2 2.8" fill="none" opacity="0.72" />
        </svg>
      );
    case 'settings':
      return (
        <svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
          <circle cx="9" cy="9" r="2.2" fill="currentColor" />
          <path d="M9 3.2V4.9M9 13.1V14.8M14.8 9H13.1M4.9 9H3.2M13.3 4.7L12.1 5.9M5.9 12.1L4.7 13.3M13.3 13.3L12.1 12.1M5.9 5.9L4.7 4.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="9" cy="9" r="5.2" stroke="currentColor" strokeWidth="1.4" fill="none" opacity="0.5" />
        </svg>
      );
    default:
      return null;
  }
}

function UtilityIcon({ kind }) {
  if (kind === 'refresh') {
    return (
      <svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
        <path d="M14.2 9A5.2 5.2 0 1 1 12.7 5.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        <path d="M10.9 4.1H14.6V7.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path d="M6.3 5.2H3.8V14.2H12.8V11.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M8.4 9.6L14.6 3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10.7 3.4H14.6V7.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

function summarizeWorkspaceRuns(runs) {
  const total = runs.length;
  const succeeded = runs.filter((run) => run.status === 'succeeded').length;
  const failed = runs.filter((run) =>
    ['failed', 'cancelled'].includes(run.status)
  ).length;
  const running = runs.filter((run) =>
    ['created', 'queued', 'planning', 'running', 'cancelling'].includes(run.status)
  ).length;
  const completedRuns = succeeded + failed;

  const durationValues = runs
    .map((run) => runDurationMs(run))
    .filter((value) => Number.isFinite(value) && value > 0);
  const averageDurationMs = durationValues.length
    ? durationValues.reduce((sum, value) => sum + value, 0) / durationValues.length
    : 0;

  return {
    averageDuration: averageDurationMs ? formatDurationMs(averageDurationMs) : '—',
    completedRuns,
    failed,
    running,
    successRate: completedRuns ? `${((succeeded / completedRuns) * 100).toFixed(1)}%` : '—',
    succeeded,
    total
  };
}

function dashboardStatusTone(status) {
  if (status === 'succeeded') {
    return 'success';
  }

  if (status === 'failed' || status === 'cancelled') {
    return 'failed';
  }

  return 'running';
}

function humanizeRunLoadState(status) {
  if (status === 'loading') {
    return 'Loading';
  }

  if (status === 'error') {
    return 'Offline';
  }

  return 'Live';
}

function humanizeRunStatus(status) {
  if (!status) {
    return 'Unknown';
  }

  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function shortRunId(runId) {
  return runId?.startsWith('run_') ? runId.slice(4) : runId;
}

function formatRunTimestamp(timestamp) {
  if (!timestamp) {
    return '—';
  }

  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    second: '2-digit',
    year: 'numeric'
  }).format(value);
}

function formatRunDuration(run) {
  const durationMs = runDurationMs(run);
  return durationMs ? formatDurationMs(durationMs) : '—';
}

function runDurationMs(run) {
  if (!run?.started_at) {
    return 0;
  }

  const started = new Date(run.started_at).getTime();
  const finished = run.finished_at ? new Date(run.finished_at).getTime() : Date.now();

  if (!Number.isFinite(started) || !Number.isFinite(finished)) {
    return 0;
  }

  return Math.max(0, finished - started);
}

function formatDurationMs(durationMs) {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }

  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function countRunRetries(run) {
  return (run?.node_runs ?? []).reduce(
    (sum, nodeRun) => sum + Math.max(0, (nodeRun.attempt ?? 1) - 1),
    0
  );
}

function countRunErrors(run) {
  const nodeFailures = (run?.node_runs ?? []).filter((nodeRun) => nodeRun.error).length;
  return run?.error ? Math.max(nodeFailures, 1) : nodeFailures;
}

async function refreshSession(setSessionState) {
  let session = UNAUTHENTICATED_SESSION;

  try {
    session = normalizeSession(await getSession());
  } catch (error) {
    session = UNAUTHENTICATED_SESSION;
  }

  setSessionState({ status: 'ready', session });
  return session;
}

function normalizeSession(session) {
  return {
    authenticated: Boolean(session?.authenticated),
    active_workspace_id: session?.active_workspace_id ?? null,
    user: session?.user ?? null,
    workspaces: Array.isArray(session?.workspaces) ? session.workspaces : []
  };
}

function getDefaultAppPath(session) {
  if (!session?.authenticated) {
    return '/login';
  }

  if (!session.workspaces.length) {
    return '/workspaces/new';
  }

  const activeWorkspace =
    session.workspaces.find(
      (workspace) => workspace.workspace_id === session.active_workspace_id
    ) ?? session.workspaces[0];

  return `/w/${activeWorkspace.slug}/overview`;
}

function readStoredViewMode() {
  if (typeof window === 'undefined') {
    return 'desktop';
  }

  try {
    const raw = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    return raw === 'mobile' ? 'mobile' : 'desktop';
  } catch (error) {
    return 'desktop';
  }
}

function readStoredSidebarCollapsed() {
  if (typeof window === 'undefined') {
    return false;
  }

  const storedValue = window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY);
  return storedValue ? storedValue === 'true' : false;
}

function readStoredAttentionCollapsed() {
  if (typeof window === 'undefined') {
    return false;
  }

  const storedValue = window.localStorage.getItem(ATTENTION_COLLAPSE_STORAGE_KEY);
  return storedValue ? storedValue === 'true' : false;
}
