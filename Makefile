#
# Copyright (c) 2014, Joyent, Inc. All rights reserved.
#
# Makefile: top-level Makefile
#
# This Makefile contains only repo-specific logic and uses included makefiles
# to supply common targets (javascriptlint, jsstyle, restdown, etc.), which are
# used by other repos as well.
#

#
# Tools
#
NPM		 = npm

#
# Files
#
JS_FILES	:= $(shell find lib examples tests -name '*.js')
JSON_FILES	 = package.json
JSL_FILES_NODE   = $(JS_FILES)
JSSTYLE_FILES	 = $(JS_FILES)
JSL_CONF_NODE	 = jsl.node.conf

.PHONY: all
all:
	$(NPM) install

.PHONY: test
test:
	node tests/tst.vstream.js > /dev/null
	@echo all tests passed

include ./Makefile.targ
