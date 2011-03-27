 var sys = require('sys');
var _ = require('underscore');
var rclient = require('./redisclient');

var global_action_list = "actions";
var list_max_size = 1000;
var listener;

