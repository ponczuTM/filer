# Przekierowanie z HTTP na HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name filer.exon.pl;
    return 301 https://$host$request_uri;
}

# Główna konfiguracja HTTPS
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name filer.exon.pl;

    # Limity wielkości i czasów dla dużych plików (np. do 3GB)
    client_max_body_size 3G;
    client_body_timeout 3600s;
    proxy_read_timeout 3600s;
    proxy_connect_timeout 3600s;
    proxy_send_timeout 3600s;

    # Ścieżki do plików certyfikatów
    ssl_certificate /etc/ssl/exon-certs/cert.pem;
    ssl_certificate_key /etc/ssl/exon-certs/key.pem;

    # Bezpieczne ustawienia protokołów SSL
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    root /var/www/filer.exon.pl/frontend;
    index index.html index.htm;

    # Obsługa frontendu React
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Przekierowanie ruchu API do backendu na porcie 2233
    location /api/ {
        proxy_pass http://127.0.0.1:2233;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    access_log /var/log/nginx/filer.exon.pl.access.log;
    error_log /var/log/nginx/filer.exon.pl.error.log;
}