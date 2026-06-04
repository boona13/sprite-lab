package server

import (
	"sync"
	"time"
)

type rateLimiter struct {
	mu       sync.Mutex
	limit    int
	window   time.Duration
	visitors map[string]visitor
}

type visitor struct {
	count     int
	resetTime time.Time
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{
		limit:    limit,
		window:   window,
		visitors: make(map[string]visitor),
	}
}

func (r *rateLimiter) allow(key string) bool {
	now := time.Now()

	r.mu.Lock()
	defer r.mu.Unlock()

	v := r.visitors[key]
	if now.After(v.resetTime) {
		r.visitors[key] = visitor{count: 1, resetTime: now.Add(r.window)}
		r.cleanup(now)
		return true
	}

	if v.count >= r.limit {
		return false
	}

	v.count++
	r.visitors[key] = v
	return true
}

func (r *rateLimiter) cleanup(now time.Time) {
	for key, v := range r.visitors {
		if now.After(v.resetTime) {
			delete(r.visitors, key)
		}
	}
}
