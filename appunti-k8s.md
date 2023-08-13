# Componenenti

## Pod
Astrazione del container docker nella rete kubernetes

## Service
Una sorta di label per la comunicazione tra i vari pods (invece di usare gli ip privati dei pods, si usa il nome del service)

## Ingress
Riceve il traffico dall'esterno e lo inoltra ai pods tramite i services

## ConfigMap
Configurazione esterna della nostra applicazione (l'equivalemte di quello che facevamo con i file .env ma non va usato per le credenziali o informazioni sensibili)

## Secret
Particolare ConfigMap, usato per le informazioni sensibili (credenziali ecc), solitamente codificate in base64

## Volume
Salva lo stato, rendendo i dati persistenti, come con i volumes di docker

## Deployment
Astrazione dei pods, con il quale è possibile specificare quante replicas dei pods devono esserci, per lo scale up/down e per garantire continuità del servizio nel caso in cui un pod crasha

## StatefulSet
Particolare deployment, usato per i db che devono accedere allo stesso data storage condiviso, in questo modo allineano le proprie istanze dei dati evitando incongruenze. Sono difficili da gestire, proprio per questo spesso i db vengono hostati all'esterno della rete k8s (come nel nostro caso con MongoDB)

<hr>

# Architettura

L'architettura di k8s è basata sui nodi, che implementano il pattern master-slave. 

## Slave Nodes

Gli slave-nodes contengono diversi pods in esecuzione e k8s prevede tre processi principali che devono essere installati in ciascun nodo per lo schedule e la gestione di queste parti:
- <b>Container Runtime</b>: l'istanza di uno o più pods presenti nel nodo.
- <b>Kubelet</b>: processo che schedula i vari container runtime nel nodo; esso comunica sia con i container che con il nodo stesso ed è il processo che avvia il pod con un container all'interno, assegnando il giusto quantitativo di risorse del nodo, come CPU e RAM.
- <b>Kube Proxy</b>: orchestra in maniera intelligente l'inoltro delle richieste interne alla rete k8s. Ad esempio ho due pods (web-app e db) e due nodi, entrambi con una replica dei due pods. Se la web-app del nodo1 vuole parlare con il db, la richiesta non verrà inoltrata al db del nodo2 ma Kube Proxy farà in modo che la richiesta resti interna al nodo, per diminuire drasticamente l'overhead.

## Master Nodes

I master-nodes, che a loro volta possono presentare delle repliche, si occupa dello schedule dei pods all'interno degli slave-nodes, oppure se un replica crasha presenta un processo di monitoraggio per individuare il problema ed effettuare il re-schedule/re-start del pod. Quindi i processi di un master-node sono completamente differenti:
- <b>API Server</b>: accessibile tramite GUI o CLI, è una sorta di cluster gateway con il quale è possibile eseguire operazioni all'interno della rete k8s, come ad esempio il deploy di una nuova app, e in particolare riceve e ascolta solamente richieste autenticate e autorizzate. In altre parole, ogni volta che si vuole creare un qualunque componente nuovo nel cluster o hostare una nuova applicazione, si invia una richiesta a k8s tramite l'API Server, esso verifica la validità della richiesta e, se siamo autenticati, inoltra la richiesta al processo che si occupa di servirla. Ottimo per la sicurezza per espone un singolo entrypoint per il cluster.
- <b>Scheduler</b>: meccanismo intelligente per l'inoltro delle richieste in arrivo dall'API Server verso il rispettivo slave-nodo. Ad esempio per la creazione di un nuovo pod, controlla l'utilizzo delle risorse CPU e RAM nei singoli slave-nodes e inserisce il nuovo pod nel nodo che ha un minor consumo delle risorse, quindi comunica con Kubelet dello specifico slave-node.
- <b>Controller Manager</b>: rileva i cambiamenti di stato del cluster k8s, come il crash di un pod o di un intero nodo. Ad esempio, quando un pod crasha viene rilevato dal Controller Manager, il quale si occupa di ripristinare lo stato del cluster nel minor tempo possibile, inviando una richiesta allo Scheduler che la inoltra ad uno specifico nodo secondo la logica spiegata precedentemente.
- <b>etcd</b>: salva lo stato del cluster k8s mediante un meccanismo key-value (astrazione del cervello del cluster). Le application data non vengono salvate qui, ma nei volumes all'interno degli slave-nodes. In etcd vengono inserite le informzioni riguardanti i nodi e i vari componenti, come pods, services, secrets, ecc. e vengono aggiornate all'atto della creazione, modifica o cancellazione di ogni singolo componente.

# File di Configurazione

Ogni file di configurazione è composto da quattro parti principali:
- <b>ApiVersion e Kind</b>: le prime due righe del file di configurazione che specificano l'API da utilizzare e il tipo di componente che si vuole creare.
- <b>Metadata</b>: una lista dei metadati del componente che vogliamo creare. Uno dei campi principale è appunto <b>name</b> che specifica il nome del componente.
- <b>Specification</b>: la configurazione vera e propria che vogliamo applicare al componente. Presenta una lista di attributi, specifici proprio in base al tipo di componente.
- <b>Status</b>: automaticamente generato e aggiunto da k8s per verificare che lo stato attuale corrisponda a quello desiderato. È alla base del meccanismo di sealf-healing di k8s, il quale riceve queste informazioni da 
<b>etcd</b>
