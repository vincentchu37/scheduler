# Use the official PHP image as the base
FROM webdevops/php-nginx:8.4-alpine
RUN apk update && apk add sqlite-dev
# (Optional) Install extra PHP extensions
RUN docker-php-ext-install pdo pdo_sqlite
# Copy your PHP application code into the container
COPY app /app
RUN chown -R 1000:1000 /app
RUN touch /app/events.db