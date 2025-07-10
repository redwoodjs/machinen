import { defineApp } from "rwsdk/worker";
import { route, render } from "rwsdk/router";
import { Document } from "@/app/Document";

import { EditorPage } from "@/app/pages/editor/EditorPage";
import { TermPage } from "@/app/pages/TermPage";
import { ClaudePocPage } from "@/app/pages/claude-poc/ClaudePocPage";
import { fetchContainer } from "./container";
export { RuntimeContainer as Container } from "./container";

import { TestPage } from "@/app/pages/TestPage";
import { 
  generateOAuthURL, 
  exchangeCodeForTokens, 
  makeClaudeRequest, 
  getStoredTokens 
} from "./claude-oauth";

export default defineApp([
  render(Document, [
    route("/", ClaudePocPage),
    route("/editor", EditorPage),
    route("/editor*", EditorPage),
    route("/ping", () => new Response("pong")),
    route("/term", TermPage),
    route("/resize", TestPage),
  ]),

  route("/preview*", async ({ request }) => {
    return fetchContainer(request);
  }),

  // OAuth routes
  route("/api/auth/claude/login", async ({ request }) => {
    const { url, state } = generateOAuthURL();
    
    console.log('Generated OAuth URL:', url);
    console.log('State for this request:', state);
    
    return new Response(null, {
      status: 302,
      headers: {
        'Location': url,
      },
    });
  }),

  route("/api/auth/claude/exchange", async ({ request }) => {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }
    
    const url = new URL(request.url);
    const baseURL = `${url.protocol}//${url.host}`;
    
    try {
      const { code } = await request.json();
      
      if (!code) {
        return new Response(JSON.stringify({ error: 'Missing code' }), { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Generate a session ID for this exchange
      const sessionId = Math.random().toString(36).substring(7);
      
      const tokens = await exchangeCodeForTokens(code, sessionId, baseURL);
      
      // Create credentials file in container
      try {
        const credentialsResponse = await fetch('http://localhost:8911/claude/credentials', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: Date.now() + tokens.expires_in * 1000,
          }),
        });
        
        if (!credentialsResponse.ok) {
          console.error('Failed to create credentials file in container');
        } else {
          console.log('Claude credentials created in container');
        }
      } catch (error) {
        console.error('Error creating credentials in container:', error);
      }
      
      return new Response(JSON.stringify({ success: true }), {
        headers: { 
          'Content-Type': 'application/json',
          'Set-Cookie': `claude_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax`,
        }
      });
    } catch (error) {
      console.error('OAuth exchange error:', error);
      return new Response(JSON.stringify({ error: error.message }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }),

  route("/api/claude/query", async ({ request }) => {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }
    
    const cookies = request.headers.get('Cookie') || '';
    const sessionMatch = cookies.match(/claude_session=([^;]+)/);
    const sessionId = sessionMatch?.[1];
    
    if (!sessionId) {
      return new Response(JSON.stringify({ error: 'No session' }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    try {
      const { message } = await request.json();
      const response = await makeClaudeRequest(sessionId, [
        { role: 'user', content: message }
      ]);
      
      return new Response(JSON.stringify(response), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('Claude query error:', error);
      return new Response(JSON.stringify({ error: error.message }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }),

  route("/api/auth/status", async ({ request }) => {
    const cookies = request.headers.get('Cookie') || '';
    const sessionMatch = cookies.match(/claude_session=([^;]+)/);
    const sessionId = sessionMatch?.[1];
    
    if (!sessionId) {
      return new Response(JSON.stringify({ authenticated: false }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    const tokens = getStoredTokens(sessionId);
    return new Response(JSON.stringify({ 
      authenticated: !!tokens,
      expires_at: tokens?.expires_at 
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }),
]);
