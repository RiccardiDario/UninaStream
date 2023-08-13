FROM node:18.14.2-slim

# copia tutta la cartella in una directory nel container e spostati in questa directory
COPY . /user-manager
WORKDIR /user-manager

# installa tutte le dipendenze
RUN npm install

# metti il container in ascolto sulla porta 5000
EXPOSE 5000

# avvia la web app
CMD ["npm", "start"]
