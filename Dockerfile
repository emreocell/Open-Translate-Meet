FROM composer:2 AS composer
FROM php:8.4-apache

RUN apt-get update && apt-get install -y --no-install-recommends \
      libcurl4-openssl-dev libonig-dev libpng-dev libjpeg62-turbo-dev libwebp-dev \
      ffmpeg unzip ca-certificates \
    && docker-php-ext-configure gd --with-jpeg --with-webp \
    && docker-php-ext-install -j"$(nproc)" curl mbstring gd \
    && a2enmod headers rewrite \
    && rm -rf /var/lib/apt/lists/*
COPY --from=composer /usr/bin/composer /usr/local/bin/composer
WORKDIR /var/www/html
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-plugins --prefer-dist --no-interaction --optimize-autoloader
COPY . .
COPY deploy/apache.conf /etc/apache2/conf-available/meeting.conf
COPY deploy/php.ini /usr/local/etc/php/conf.d/meeting.ini
RUN a2enconf meeting && mkdir -p /var/lib/meet && chown www-data:www-data /var/lib/meet && chmod 700 /var/lib/meet
ENV MEET_PRIVATE_DIR=/var/lib/meet
EXPOSE 80
CMD ["apache2-foreground"]
