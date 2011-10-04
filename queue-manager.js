//This takes the input queues and picks which items to fund with resources until no more resources are left to distribute.
//
//In this manager all resources are 'flattened' into a single type=(food+wood+metal+stone+pop*50 (see resources.js))
//the following refers to this simple as resource
//
// Each queue has an account which records the amount of resource it can spend.  If no queue has an affordable item
// then the amount of resource is increased to all accounts in direct proportion to the priority until an item on one
// of the queues becomes affordable.
//
// A consequence of the system is that a rarely used queue will end up with a very large account.  I am unsure if this
// is good or bad or neither.
//
// Each queue object has two queues in it, one with items waiting for resources and the other with items which have been 
// allocated resources and are due to be executed.  The secondary queues are helpful because then units can be trained
// in groups of 5 and buildings are built once per turn to avoid placement clashes.

var QueueManager = function(queues, priorities) {
	this.queues = queues;
	this.priorities = priorities;
	this.account = {};
	for (p in this.queues) {
		this.account[p] = 0;
	}
	this.curItemQueue = [];
};

QueueManager.prototype.getAvailableResources = function(gameState) {
	var resources = gameState.getResources();
	for (key in this.queues) {
		resources.subtract(this.queues[key].outQueueCost());
	}
	return resources;
};

QueueManager.prototype.futureNeeds = function(gameState) {
	// Work out which plans will be executed next using priority and return the total cost of these plans
	var recurse = function(queues, qm, number, depth){
		var needs = new Resources();
		var totalPriority = 0;
		for (var i = 0; i < queues.length; i++){
			totalPriority += qm.priorities[queues[i]];
		}
		for (var i = 0; i < queues.length; i++){
			var num = Math.round(((qm.priorities[queues[i]]/totalPriority) * number));
			if (num < qm.queues[queues[i]].countQueuedUnits()){
				var cnt = 0;
				for ( var j = 0; cnt < num; j++) {
					cnt += qm.queues[queues[i]].queue[j].number;
					needs.add(qm.queues[queues[i]].queue[j].getCost());
					number -= qm.queues[queues[i]].queue[j].number;
				}
			}else{
				for ( var j = 0; j < qm.queues[queues[i]].length(); j++) {
					needs.add(qm.queues[queues[i]].queue[j].getCost());
					number -= qm.queues[queues[i]].queue[j].number;
				}
				queues.splice(i, 1);
				i--;
			}
		}
		// Check that more items were selected this call and that there are plans left to be allocated
		// Also there is a fail-safe max depth 
		if (queues.length > 0 && number > 0 && depth < 20){
			needs.add(recurse(queues, qm, number, depth + 1));
		}
		return needs;
	};
	
	//number of plans to look at
	var current = this.getAvailableResources(gameState);
	
	var futureNum = 20;
	var queues = [];
	for (q in this.queues){
		queues.push(q);
	}
	var needs = recurse(queues, this, futureNum, 0);
	return {
		"food" : Math.max(needs.food - current.food, 0) + 150,
		"wood" : Math.max(needs.wood + 15*needs.population - current.wood, 0) + 150, //TODO: read the house cost in case it changes in the future
		"stone" : Math.max(needs.stone - current.stone, 0) + 100,
		"metal" : Math.max(needs.metal - current.metal, 0) + 100
	};
};

// runs through the curItemQueue and allocates resources be sending the
// affordable plans to the Out Queues. Returns a list of the unneeded resources
// so they can be used by lower priority plans.
QueueManager.prototype.affordableToOutQueue = function(gameState) {
	var available = {
		"food" : true,
		"wood" : true,
		"stone" : true,
		"metal" : true
	};
	if (this.curItemQueue.length === 0) {
		return available;
	}

	var resources = this.getAvailableResources(gameState);

	// Check everything in the curItemQueue, if it is affordable then mark it
	// for execution
	for ( var i = 0; i < this.curItemQueue.length; i++) {
		if (resources.canAfford(this.queues[this.curItemQueue[i]].getNext().getCost())) {
			this.account[this.curItemQueue[i]] -= this.queues[this.curItemQueue[i]].getNext().getCost().toInt();
			this.queues[this.curItemQueue[i]].nextToOutQueue();
			resources = this.getAvailableResources(gameState);
			this.curItemQueue[i] = null;
			for (key in available) {
				available[key] = false;
			}
		} else {
			for (key in available) {
				if (this.queues[this.curItemQueue[i]].getNext().getCost()[key] != 0) {
					available[key] = false;
				}
			}
		}
	}

	// Clear the spent items
	var tmpQueue = [];
	for ( var i = 0; i < this.curItemQueue.length; i++) {
		if (this.curItemQueue[i] !== null) {
			tmpQueue.push(this.curItemQueue[i]);
		}
	}
	this.curItemQueue = tmpQueue;

	return available;
};

QueueManager.prototype.onlyUsesSpareAndUpdateSpare = function(unitCost, spare){
	var ret = true;
	for (key in spare){
		if (!spare[key] && unitCost[key] != 0){
			ret = false;
		}
		if (unitCost[key] != 0){
			spare[key] = false;
		}
	}
	return ret;
};

String.prototype.rpad = function(padString, length) {
	var str = this;
    while (str.length < length)
        str = str + padString;
    return str;
};

QueueManager.prototype.printQueues = function(){
	warn("OUTQUEUES");
	for (i in this.queues){
		var qStr = "";
		var q = this.queues[i];
		for (j in q.outQueue){
			qStr += q.outQueue[j].type + " ";
			if (q.outQueue[j].number)
				qStr += "x" + q.outQueue[j].number;
		}
		if (qStr != ""){
			warn((i + ":").rpad(" ", 20) + qStr);
		}
	}
	
	warn("INQUEUES");
	for (i in this.queues){
		var qStr = "";
		var q = this.queues[i];
		for (j in q.queue){
			qStr += q.queue[j].type + " ";
			if (q.queue[j].number)
				qStr += "x" + q.queue[j].number;
			qStr += "    ";
		}
		if (qStr != ""){
			warn((i + ":").rpad(" ", 20) + qStr);
		}
	}
	warn("Accounts: " + uneval(this.account));
};

QueueManager.prototype.update = function(gameState) {
	// See if there is a high priority item from last time.
	this.affordableToOutQueue(gameState);
	do {
		// pick out all affordable items, and list the ratios of (needed
		// cost)/priority for unaffordable items.
		var ratio = {};
		var ratioMin = 1000000;
		var ratioMinQueue = undefined;
		for (p in this.queues) {
			if (this.queues[p].length() > 0 && this.curItemQueue.indexOf(p) === -1) {
				var cost = this.queues[p].getNext().getCost().toInt();
				if (cost < this.account[p]) {
					this.curItemQueue.push(p);
					// break;
				} else {
					ratio[p] = (cost - this.account[p]) / this.priorities[p];
					if (ratio[p] < ratioMin) {
						ratioMin = ratio[p];
						ratioMinQueue = p;
					}
				}
			}
		}

		// Checks to see that there is an item in at least one queue, otherwise
		// breaks the loop.
		if (this.curItemQueue.length === 0 && ratioMinQueue === undefined) {
			break;
		}

		var available = this.affordableToOutQueue(gameState);

		// if there are no affordable items use any resources which aren't
		// wanted by a higher priority item
		if ((available["food"] || available["wood"] || available["stone"] || available["metal"])
				&& ratioMinQueue !== undefined) {
			while (Object.keys(ratio).length > 0 && (available["food"] || available["wood"] || available["stone"] || available["metal"])){
				ratioMin = Math.min(); //biggest value
				for (key in ratio){
					if (ratio[key] < ratioMin){
						ratioMin = ratio[key];
						ratioMinQueue = key;
					}
				}
				if (this.onlyUsesSpareAndUpdateSpare(this.queues[ratioMinQueue].getNext().getCost(), available)){
					for (p in this.queues) {
						this.account[p] += ratioMin * this.priorities[p];
					}
					//this.account[ratioMinQueue] -= this.queues[ratioMinQueue].getNext().getCost().toInt();
					this.curItemQueue.push(ratioMinQueue);
				}
				delete ratio[ratioMinQueue];
			}
			
		}

		this.affordableToOutQueue(gameState);
	} while (this.curItemQueue.length === 0)

	// Handle output queues
	// TODO: Handle multiple units in queue for faster training times -
	// partially done, need to hold queue before sending to a building
	for (p in this.queues) {
		while (this.queues[p].outQueueLength() > 0) {
			var next = this.queues[p].outQueueNext();
			if (next.category === "building") {
				if (gameState.buildingsBuilt == 0) {
					if (this.queues[p].outQueueNext().canExecute(gameState)) {
						this.queues[p].executeNext(gameState);
						gameState.buildingsBuilt += 1;
					} else {
						break;
					}
				} else {
					break;
				}
			} else {
				if (this.queues[p].outQueueNext().canExecute(gameState)){
					this.queues[p].executeNext(gameState);
				}else{
					break;
				}
			}
		}
	}
	//warn(uneval(this.futureNeeds(gameState)));
};
