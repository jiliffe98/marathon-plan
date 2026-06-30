#!/usr/bin/env python3
"""
One-time helper to get your Strava refresh token (no curl needed).

Usage:
    python scripts/get_token.py
It will ask for your Client ID and Client Secret (from
https://www.strava.com/settings/api), open your browser to authorize, catch the
response automatically, and print the STRAVA_REFRESH_TOKEN to paste into GitHub.

Note: make sure your Strava app's "Authorization Callback Domain" is set to
      localhost (the port doesn't matter).
"""
import http.server, json, threading, urllib.parse, urllib.request, webbrowser

PORT = 8000
REDIRECT = f"http://localhost:{PORT}"
code_holder = {}

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        q = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(q)
        code_holder["code"] = params.get("code", [None])[0]
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b"<h2>Done. You can close this tab and return to the terminal.</h2>")
    def log_message(self, *a):
        pass

def main():
    cid = input("Strava Client ID: ").strip()
    secret = input("Strava Client Secret: ").strip()

    auth = ("https://www.strava.com/oauth/authorize?"
            + urllib.parse.urlencode({
                "client_id": cid, "response_type": "code", "redirect_uri": REDIRECT,
                "approval_prompt": "force", "scope": "activity:read_all"}))

    srv = http.server.HTTPServer(("localhost", PORT), Handler)
    threading.Thread(target=srv.handle_request, daemon=True).start()

    print("\nOpening your browser to authorize… (click Authorize)")
    print("If it doesn't open, paste this URL:\n " + auth + "\n")
    webbrowser.open(auth)

    while "code" not in code_holder:
        pass
    code = code_holder["code"]
    if not code:
        raise SystemExit("No code received. Check the callback domain is 'localhost'.")

    body = urllib.parse.urlencode({
        "client_id": cid, "client_secret": secret,
        "code": code, "grant_type": "authorization_code"}).encode()
    req = urllib.request.Request("https://www.strava.com/oauth/token", data=body)
    tok = json.loads(urllib.request.urlopen(req).read().decode())

    print("\n=========================================================")
    print("STRAVA_REFRESH_TOKEN =", tok["refresh_token"])
    print("=========================================================")
    print("Paste that into GitHub: Settings > Secrets and variables > Actions.")

if __name__ == "__main__":
    main()
