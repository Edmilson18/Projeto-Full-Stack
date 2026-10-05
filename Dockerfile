# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

# Copia os arquivos de dependências
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/config/tsconfig.base.json ./packages/config/

# Instala as dependências (inclui as de desenvolvimento: é o que compila)
RUN npm ci

# Copia o código fonte
COPY . .

# Compila os pacotes
RUN npm run build

# Production stage
FROM node:24-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Copia apenas os arquivos necessários para produção
COPY package.json package-lock.json ./
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/apps/web/package.json ./apps/web/
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
# As migrações entram para o `db:migrate:dist`. O `db:migrate` normal usa `tsx`,
# que é devDependency e não existe nesta imagem — dentro do contêiner ele falha
# com `sh: tsx: not found`. Opcional aqui: `server.js` já chama
# `inicializarBanco()`, que aplica as migrações pendentes ao subir.
COPY database/migrations ./database/migrations

# Instala apenas dependências de produção.
# `--ignore-scripts` é obrigatório: sem ele, o `prepare` da raiz chama `husky`,
# que é devDependency e portanto não existe aqui — a instalação morre com
# `sh: husky: not found` e a imagem nunca é construída. `HUSKY=0` não resolve,
# porque o problema não é o hook rodando, é o binário ausente. Nenhuma
# dependência de produção deste projeto tem script de instalação.
RUN npm ci --omit=dev --ignore-scripts

EXPOSE 3000

CMD ["npm", "start"]
