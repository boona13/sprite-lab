package server

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/ggampp/sprite-lab/internal/generate"
	"github.com/ggampp/sprite-lab/internal/store"
)

type Config struct {
	Addr          string
	StaticDir     string
	AllowedOrigin string
	CookieSecure  bool
}

type Server struct {
	cfg       Config
	generator *generate.Service
	store     *store.Store
	limiter   *rateLimiter
}

func New(cfg Config, generator *generate.Service, db *store.Store) *Server {
	if cfg.Addr == "" {
		cfg.Addr = ":8787"
	}
	if cfg.StaticDir == "" {
		cfg.StaticDir = "dist"
	}

	return &Server{
		cfg:       cfg,
		generator: generator,
		store:     db,
		limiter:   newRateLimiter(12, time.Hour),
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.health)
	mux.HandleFunc("/api/auth/register", s.register)
	mux.HandleFunc("/api/auth/login", s.login)
	mux.HandleFunc("/api/auth/logout", s.logout)
	mux.HandleFunc("/api/auth/me", s.me)
	mux.HandleFunc("/api/generate/presets", s.presets)
	mux.HandleFunc("/api/generate/models", s.models)
	mux.HandleFunc("/api/generate-sprite", s.generateSprite)
	mux.HandleFunc("/api/projects", s.projects)
	mux.HandleFunc("/api/projects/", s.projectRoutes)

	if _, err := os.Stat(s.cfg.StaticDir); err == nil {
		mux.Handle("/", http.FileServer(http.Dir(s.cfg.StaticDir)))
	}

	return s.securityHeaders(mux)
}

func (s *Server) ListenAndServe(ctx context.Context) error {
	httpServer := &http.Server{
		Addr:              s.cfg.Addr,
		Handler:           s.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      90 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	errCh := make(chan error, 1)
	go func() {
		errCh <- httpServer.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return httpServer.Shutdown(shutdownCtx)
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) presets(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"presets": generate.Presets})
}

func (s *Server) models(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"models":       s.generatorModels(),
		"aspectRatios": generate.AllowedAspectRatios,
		"imageSizes":   generate.AllowedImageSizes,
	})
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8*1024)
	defer r.Body.Close()

	var req struct {
		Email    string `json:"email"`
		Name     string `json:"name"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	user, err := s.store.CreateUser(r.Context(), req.Email, req.Name, req.Password)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	session, err := s.store.CreateSession(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create session")
		return
	}
	setSessionCookie(w, session, s.cfg.CookieSecure)
	writeJSON(w, http.StatusCreated, map[string]any{"user": user})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8*1024)
	defer r.Body.Close()

	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	user, err := s.store.Authenticate(r.Context(), req.Email, req.Password)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	session, err := s.store.CreateSession(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create session")
		return
	}
	setSessionCookie(w, session, s.cfg.CookieSecure)
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if cookie, err := r.Cookie("sprite_lab_session"); err == nil {
		_ = s.store.DeleteSession(r.Context(), cookie.Value)
	}
	clearSessionCookie(w)
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (s *Server) generateSprite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	if !s.limiter.allow(clientIP(r)) {
		writeError(w, http.StatusTooManyRequests, "rate limit exceeded")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	defer r.Body.Close()

	var req struct {
		generate.Request
		ProjectID int64 `json:"projectId"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 80*time.Second)
	defer cancel()

	res, err := s.generator.Generate(ctx, req.Request)
	if err != nil {
		status := http.StatusBadGateway
		msg := err.Error()
		if isClientError(msg) {
			status = http.StatusBadRequest
		}
		writeError(w, status, msg)
		return
	}

	if req.ProjectID > 0 {
		image, err := s.store.AddProjectImage(r.Context(), user.ID, req.ProjectID, store.ProjectImage{
			Kind:      "generated",
			Name:      "generated-sprite.png",
			Prompt:    res.Prompt,
			Model:     res.Model,
			ImageData: res.ImageURL,
		})
		if err == nil {
			writeJSON(w, http.StatusOK, map[string]any{
				"imageUrl": res.ImageURL,
				"model":    res.Model,
				"prompt":   res.Prompt,
				"content":  res.Content,
				"stored":   image,
			})
			return
		}
	}
	writeJSON(w, http.StatusOK, res)
}

func (s *Server) projects(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		projects, err := s.store.ListProjects(r.Context(), user.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not list projects")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"projects": projects})
	case http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, 4*1024)
		defer r.Body.Close()
		var req struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		project, err := s.store.CreateProject(r.Context(), user.ID, req.Name)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"project": project})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) projectRoutes(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireUser(w, r)
	if !ok {
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/projects/"), "/")
	if len(parts) < 2 || parts[1] != "images" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	projectID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid project id")
		return
	}
	switch r.Method {
	case http.MethodGet:
		images, err := s.store.ListProjectImages(r.Context(), user.ID, projectID)
		if err != nil {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"images": images})
	case http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, 12*1024*1024)
		defer r.Body.Close()
		var req store.ProjectImage
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
		image, err := s.store.AddProjectImage(r.Context(), user.ID, projectID, req)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{"image": image})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) generatorModels() []string {
	return s.generator.AllowedModels()
}

func (s *Server) requireUser(w http.ResponseWriter, r *http.Request) (store.User, bool) {
	cookie, err := r.Cookie("sprite_lab_session")
	if err != nil {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return store.User{}, false
	}
	user, err := s.store.UserBySession(r.Context(), cookie.Value)
	if err != nil {
		clearSessionCookie(w)
		writeError(w, http.StatusUnauthorized, "authentication required")
		return store.User{}, false
	}
	return user, true
}

func setSessionCookie(w http.ResponseWriter, session store.Session, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     "sprite_lab_session",
		Value:    session.Token,
		Path:     "/",
		Expires:  session.ExpiresAt,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
	})
}

func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     "sprite_lab_session",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   false,
	})
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")

		if s.cfg.AllowedOrigin != "" {
			origin := r.Header.Get("Origin")
			if origin == s.cfg.AllowedOrigin {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
				if r.Method == http.MethodOptions {
					w.WriteHeader(http.StatusNoContent)
					return
				}
			}
		}

		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	return r.RemoteAddr
}

func isClientError(message string) bool {
	checks := []string{
		"required",
		"unknown preset",
		"not allowed",
		"characters or fewer",
	}
	for _, check := range checks {
		if strings.Contains(message, check) {
			return true
		}
	}
	return false
}
