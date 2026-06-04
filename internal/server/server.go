package server

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/ggampp/sprite-lab/internal/generate"
)

type Config struct {
	Addr          string
	StaticDir     string
	AllowedOrigin string
}

type Server struct {
	cfg       Config
	generator *generate.Service
	limiter   *rateLimiter
}

func New(cfg Config, generator *generate.Service) *Server {
	if cfg.Addr == "" {
		cfg.Addr = ":8787"
	}
	if cfg.StaticDir == "" {
		cfg.StaticDir = "dist"
	}

	return &Server{
		cfg:       cfg,
		generator: generator,
		limiter:   newRateLimiter(12, time.Hour),
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.health)
	mux.HandleFunc("/api/generate/presets", s.presets)
	mux.HandleFunc("/api/generate/models", s.models)
	mux.HandleFunc("/api/generate-sprite", s.generateSprite)

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

func (s *Server) generateSprite(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !s.limiter.allow(clientIP(r)) {
		writeError(w, http.StatusTooManyRequests, "rate limit exceeded")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	defer r.Body.Close()

	var req generate.Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 80*time.Second)
	defer cancel()

	res, err := s.generator.Generate(ctx, req)
	if err != nil {
		status := http.StatusBadGateway
		msg := err.Error()
		if isClientError(msg) {
			status = http.StatusBadRequest
		}
		writeError(w, status, msg)
		return
	}

	writeJSON(w, http.StatusOK, res)
}

func (s *Server) generatorModels() []string {
	return s.generator.AllowedModels()
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
