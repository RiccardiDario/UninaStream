import cookieParser from 'cookie-parser'
import * as dotenv from 'dotenv';
import express from 'express';
import session from 'express-session';
import Keycloak from 'keycloak-connect';
import { MongoClient, ObjectId } from 'mongodb';

import logger from './logUtil.js';
import { getVaultSecrets, getVaultDBCredentials } from './vault.js';

// read env vars
dotenv.config();

// ottiene i segreti da Vault
console.log('Attendi che Vault sia online e pronto a rispondere alle richieste HTTP');
const secrets = await getVaultSecrets(process.env.VAULT_ENDPOINT, process.env.ROLE_ID, process.env.SECRET_ID);

// crea un nuovo DB client temporaneo
var client = await createTemporaryClient();

// set global vars
const kcBaseUrl = secrets.shared.KC_BASEURL;
const kcRealm = secrets.shared.KC_REALM;
const kcClientBaseId = secrets.shared.KC_CLIENT_BASE_ID;
const sessionSecret = secrets.personal.SESSION_SECRET;

// init express
const app = express();

// Define the header middleware function
const headerMiddleware = function(req, res, next) {
  res.setHeader('Content-Security-Policy', "default-src 'self' https://auth.uninastream.ddnsfree.com; style-src 'self' https://cdnjs.cloudflare.com/; script-src 'self' https://cdnjs.cloudflare.com/; img-src 'self' data:");
  res.setHeader('X-Frame-Options', "DENY");
  res.setHeader('X-Content-Type-Options', "nosniff");
  next();
}

// Use the middleware function in your application
app.use(headerMiddleware);

// Define view engine
app.set('view engine', 'ejs');
app.use('/static', express.static('static'));

// config Keycloak
const memoryStore = new session.MemoryStore();
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: true,
    store: memoryStore
  })
);

app.use(cookieParser(sessionSecret, {
  secure: true, // Imposta il flag "Secure" sulla cookie
  sameSite: 'strict' // Imposta l'attributo "SameSite" sulla cookie
}));

const kcConfig = {
  "realm": kcRealm,
  "auth-server-url": kcBaseUrl,
  "ssl-required": "external",
  "resource": kcClientBaseId,
  "public-client": true,
  "confidential-port": 0
};
const keycloak = new Keycloak({ store: memoryStore }, kcConfig);
app.use(
  keycloak.middleware({
    logout: '/logout',
    admin: '/'
  })
);

// homepage
app.get('/', function (req, res) {
  logger.info("Main page visited");
  res.locals.session = req.session;
  res.locals.content = req.session['keycloak-token'] ? req.kauth.grant.access_token.content : {};
  res.render('pages/index');
});

// login
app.get('/login', keycloak.protect(), async function (req, res) {
  logger.info("Login page visited");
  res.redirect("/");
});

// pagina ricerca
app.get('/ricerca', keycloak.protect('realm:user'), async function (req, res) {
  logger.info("Ricerca page visited");
  res.locals.content = req.kauth.grant.access_token.content || {};
  res.locals.session = req.session || {};
  var videos = [];
  try {
    // Connessione a MongoDB e query
    await client.connect();
    let db = client.db("unina");
    const MyCollection = db.collection('video');
    // se l'utente non effettua la ricerca mostra i primi 4 video, altrimenti mostra il risultato della ricerca
    if (!req.query.q) {
      let myquery = {};
      videos = await MyCollection.find(myquery, { limit: 4 }).sort({ titolo: 1 }).toArray();
    } else {
      let myquery = { titolo: new RegExp(req.query.q, 'i') };
      videos = await MyCollection.find(myquery).sort({ titolo: 1 }).toArray();
    }
    await client.close();
  } catch (error) {
    logger.error("Client error on database connection! specific error: "+error);
    console.error(error);
  }
  res.render('pages/ricerca', { videos: videos });
});

// pagina video personali
app.get('/catalogo', keycloak.protect('realm:user'), async function (req, res) {
  logger.info("Catalogo page visited");
  res.locals.content = req.kauth.grant.access_token.content || {};
  res.locals.session = req.session || {};
  var videos = [];
  var video_ids = [];
  const user_roles = req.kauth.grant.access_token.content.realm_access.roles;
  for (var role of user_roles) {
    const regex = /^video-viewer-(\w+)$/;
    const match = role.match(regex);
    if (match) {
      const id = match[1];
      video_ids.push({ _id: new ObjectId(id) });
    }
  }
  try {
    // Connessione a MongoDB e query
    await client.connect();
    let db = client.db("unina");
    const MyCollection = db.collection('video');
    let myquery = { $or: video_ids };
    videos = await MyCollection.find(myquery).sort({ titolo: 1 }).toArray();
    await client.close();
  } catch (error) {
    logger.error("Client error on database connection! specific error: "+error);
    console.error(error);
  }
  res.render('pages/catalogo', { videos: videos });
});

// pagina visualizza video
app.get('/visualizza', keycloak.protect('realm:user'), async function (req, res) {
  logger.info("Visualizza page visited");
  res.locals.content = req.kauth.grant.access_token.content || {};
  res.locals.session = req.session || {};
  var video = [];
  if (!req.query.id) {
    // nessun id è stato specificato, redirect homepage
    res.redirect('/');
  } else {
    try {
      // Connessione a MongoDB e query
      await client.connect();
      let db = client.db("unina");
      const MyCollection = db.collection('video');
      let myquery = { _id: new ObjectId(req.query.id) };
      video = await MyCollection.findOne(myquery);
      await client.close();
      // se l'utente non ha i permessi di accesso al video selezionato
      if ((req.kauth.grant.access_token.content.realm_access.roles.includes('video-viewer-' + video._id)) == false) {
        var error_msg = 'Acquista singolarmente il video';
        if (video.abbonamento) {
          error_msg += ' oppure compra l\'abbonamento!';
        }
        return res.render('pages/error', { error: error_msg });
      }
    } catch (error) {    
      logger.error("Client error on database connection! specific error: "+error);
      console.error(error);
    }
  }
  res.render('pages/visualizza', { video: video });
});

app.all('*', async function (req, res) {
  logger.warn("Wrong path requested: "+req.url);
  console.log(req.url);
  res.locals.session = req.session;
  res.locals.content = req.session['keycloak-token'] ? req.kauth.grant.access_token.content : {};
  res.render('pages/404');
})

async function createTemporaryClient(){
  console.log("creating new DB temporary client...");
  const db = await getVaultDBCredentials(process.env.VAULT_ENDPOINT, process.env.ROLE_ID, process.env.SECRET_ID);
  const mongoUrl ='mongodb+srv://'+db.username+':'+db.password+'@cluster0.dj6bwc7.mongodb.net/?retryWrites=true&w=majority';
  const client = new MongoClient(mongoUrl);
  return client;
}

const taskInterval=60*60*1000; // every hour
setInterval(async () => {
  var temp_client = await createTemporaryClient();
  await new Promise((resolve) => setTimeout(resolve, 60000));
  client = temp_client;
}, taskInterval);

app.listen(5000);
console.log('Server is listening on port 5000');
