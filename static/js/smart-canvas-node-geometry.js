(function attachSmartCanvasNodeGeometry(global){
    'use strict';

    function nodeRect(node, layoutForNode){
        const layout = typeof layoutForNode === 'function' ? (layoutForNode(node) || {}) : {};
        return {
            x:node?.x || 0,
            y:node?.y || 0,
            width:Number(layout.width) || 0,
            height:Number(layout.height) || 0
        };
    }

    function geometryOptions(options={}){
        return {
            isSmartImageNode: typeof options.isSmartImageNode === 'function'
                ? options.isSmartImageNode
                : node => node?.type === 'smart-image',
            isHistoryGroupNode: typeof options.isHistoryGroupNode === 'function'
                ? options.isHistoryGroupNode
                : () => false,
            mediaKindForItem: typeof options.mediaKindForItem === 'function'
                ? options.mediaKindForItem
                : item => item?.kind || 'image',
            mediaLayoutSize: typeof options.mediaLayoutSize === 'function'
                ? options.mediaLayoutSize
                : () => ({width:0, height:0}),
            rectForNode: typeof options.rectForNode === 'function'
                ? options.rectForNode
                : node => ({x:node?.x || 0, y:node?.y || 0, width:0, height:0})
        };
    }

    function singleImageAspectRatio(node, options={}){
        const deps = geometryOptions(options);
        if(!deps.isSmartImageNode(node) || deps.isHistoryGroupNode(node) || (node?.images || []).length !== 1) return 0;
        const image = node.images[0];
        if(deps.mediaKindForItem(image) !== 'image') return 0;
        const size = deps.mediaLayoutSize(image) || {};
        if(Number(size.width) > 0 && Number(size.height) > 0) return Number(size.width) / Number(size.height);
        const rect = deps.rectForNode(node) || {};
        return Number(rect.width) > 0 && Number(rect.height) > 0 ? Number(rect.width) / Number(rect.height) : 0;
    }

    function resetSingleImageAspect(node, options={}){
        const deps = geometryOptions(options);
        const ratio = singleImageAspectRatio(node, deps);
        if(!(ratio > 0)) return false;
        const rect = deps.rectForNode(node) || {};
        node.w = Math.max(48, Math.round(Number(rect.width) || 0));
        node.h = Math.max(48, Math.round(node.w / ratio));
        node.scale = 1;
        return true;
    }

    function existingNodeIds(ids, nodes){
        const available = new Set((nodes || []).map(node => node?.id).filter(Boolean));
        return [...new Set((ids || []).filter(id => available.has(id)))];
    }

    function isLayoutConnection(connection){
        return Boolean(connection?.from && connection?.to)
            && (connection.kind || 'flow') !== 'history';
    }

    function connectedClusterIds(seedId, nodes, connections){
        const available = new Set((nodes || []).map(node => node?.id).filter(Boolean));
        if(!available.has(seedId)) return [];
        const seen = new Set([seedId]);
        const queue = [seedId];
        while(queue.length){
            const id = queue.shift();
            (connections || []).forEach(connection => {
                if(!isLayoutConnection(connection)) return;
                if(connection?.from !== id && connection?.to !== id) return;
                const next = connection.from === id ? connection.to : connection.from;
                if(!available.has(next) || seen.has(next)) return;
                seen.add(next);
                queue.push(next);
            });
        }
        return [...seen];
    }

    function arrangeSingleConnectedGroup(ids, nodes, connections, rectForNode, options={}){
        const orderedIds = options.preFiltered ? ids : existingNodeIds(ids, nodes);
        const nodesById = new Map((nodes || []).filter(node => node?.id).map(node => [node.id, node]));
        const selected = orderedIds.map(id => nodesById.get(id)).filter(Boolean);
        if(selected.length < 2) return [];

        const getRect = typeof rectForNode === 'function' ? rectForNode : node => node;
        const rects = new Map(selected.map(node => [node.id, getRect(node) || {}]));
        const startX = Math.min(...selected.map(node => Number(rects.get(node.id).x) || 0));
        const startY = Math.min(...selected.map(node => Number(rects.get(node.id).y) || 0));
        const selectedIds = new Set(orderedIds);
        const internal = (connections || []).filter(connection => isLayoutConnection(connection)
            && selectedIds.has(connection?.from) && selectedIds.has(connection?.to));
        const depth = new Map(selected.map(node => [node.id, 0]));

        if(internal.length){
            const indegree = new Map(selected.map(node => [node.id, 0]));
            internal.forEach(connection => indegree.set(connection.to, (indegree.get(connection.to) || 0) + 1));
            const roots = [...indegree.entries()].filter(([, count]) => count === 0).map(([id]) => id);
            const queue = roots.length ? roots.slice() : [selected[0].id];
            const seen = new Set(queue);
            while(queue.length){
                const id = queue.shift();
                internal.filter(connection => connection.from === id).forEach(connection => {
                    depth.set(connection.to, Math.max(depth.get(connection.to) || 0, (depth.get(id) || 0) + 1));
                    if(seen.has(connection.to)) return;
                    seen.add(connection.to);
                    queue.push(connection.to);
                });
            }
        }

        const columns = new Map();
        selected.forEach(node => {
            const column = depth.get(node.id) || 0;
            if(!columns.has(column)) columns.set(column, []);
            columns.get(column).push(node);
        });

        const maxNodesPerColumn = options.maxNodesPerColumn || 4;
        const visualColumns = [];
        [...columns.keys()].sort((left, right) => left - right).forEach(column => {
            const columnNodes = columns.get(column).slice();
            const hasExistingOverflowColumns = columnNodes.length > maxNodesPerColumn
                && new Set(columnNodes.map(node => Number((rects.get(node.id) || {}).y) || 0)).size < columnNodes.length;
            columnNodes.sort((left, right) => {
                return (Number(left.created_at) || 0) - (Number(right.created_at) || 0)
                    || String(left.id).localeCompare(String(right.id));
            });
            for(let index = 0; index < columnNodes.length; index += maxNodesPerColumn){
                visualColumns.push(columnNodes.slice(index, index + maxNodesPerColumn));
            }
        });

        // D lays out each branch from its own upstream width instead of advancing every
        // downstream node by the widest card in an entire depth column. This keeps a wide
        // sibling without descendants from creating empty horizontal space in other branches.
        const horizontalGap = 160;
        const verticalGap = 110;
        const parentsById = new Map(selected.map(node => [node.id, []]));
        const childrenById = new Map(selected.map(node => [node.id, []]));
        internal.forEach(connection => {
            parentsById.get(connection.to)?.push(connection.from);
            childrenById.get(connection.from)?.push(connection.to);
        });

        // Treat every selected node without a selected upstream as a fixed chain anchor.
        // D may therefore compact several selected chains at once without disturbing the
        // manually positioned prompt/source nodes at the head of each chain.
        const fixedRootIds = new Set(selected
            .filter(node => !(parentsById.get(node.id) || []).length)
            .map(node => node.id));

        // A child keeps a stable slot under its own parent. Each parent gets an
        // independent grid with at most four rows: the fifth direct child begins the next
        // column. Column widths and row heights use the actual child card dimensions.
        const childGridSlotByEdge = new Map();
        childrenById.forEach((childIds, parentId) => {
            const ordered = childIds.slice().sort((leftId, rightId) => {
                const leftNode = nodesById.get(leftId) || {};
                const rightNode = nodesById.get(rightId) || {};
                return (Number(leftNode.created_at) || 0) - (Number(rightNode.created_at) || 0)
                    || String(leftId).localeCompare(String(rightId));
            });
            const slots = ordered.map((childId, index) => {
                const childRect = rects.get(childId) || {};
                return {
                    childId,
                    column:Math.floor(index / maxNodesPerColumn),
                    row:index % maxNodesPerColumn,
                    width:Number(childRect.width) || 180,
                    height:Math.max(110, Number(childRect.height) || 0)
                };
            });
            const columnWidths = [];
            const rowHeights = Array.from({length: maxNodesPerColumn}, () => 0);
            slots.forEach(slot => {
                columnWidths[slot.column] = Math.max(columnWidths[slot.column] || 0, slot.width);
                rowHeights[slot.row] = Math.max(rowHeights[slot.row], slot.height);
            });
            const columnOffsets = [];
            let xOffset = 0;
            columnWidths.forEach((width, column) => {
                columnOffsets[column] = xOffset;
                xOffset += width + horizontalGap;
            });
            const rowOffsets = [];
            let yOffset = 0;
            rowHeights.forEach((height, row) => {
                rowOffsets[row] = yOffset;
                yOffset += height + verticalGap;
            });
            slots.forEach(slot => childGridSlotByEdge.set(`${parentId}\u0000${slot.childId}`, {
                x:columnOffsets[slot.column],
                y:rowOffsets[slot.row]
            }));
        });

        const placed = new Map();
        if(options.avoidObstacles !== false){
            (nodes || []).forEach(node => {
                if(!node?.id || selectedIds.has(node.id)) return;
                const rect = getRect(node) || {};
                placed.set(node.id, {
                    x:Number.isFinite(Number(rect.x)) ? Number(rect.x) : startX,
                    y:Number.isFinite(Number(rect.y)) ? Number(rect.y) : startY,
                    width:Number(rect.width) || 180,
                    height:Math.max(110, Number(rect.height) || 0),
                    rootIds:new Set()
                });
            });
        }
        const moves = [];
        visualColumns.forEach(columnNodes => {
            columnNodes.forEach(node => {
                const rect = rects.get(node.id) || {};
                const width = Number(rect.width) || 180;
                const height = Math.max(110, Number(rect.height) || 0);

                if(fixedRootIds.has(node.id)){
                    // Roots are layout constraints, not move targets. They still enter the
                    // collision map, but only descendants of the same selected chain use
                    // one another for automatic collision avoidance.
                    placed.set(node.id, {
                        x:Number.isFinite(Number(rect.x)) ? Number(rect.x) : startX,
                        y:Number.isFinite(Number(rect.y)) ? Number(rect.y) : startY,
                        width,
                        height,
                        rootIds:new Set([node.id])
                    });
                    return;
                }

                const parentLayouts = (parentsById.get(node.id) || [])
                    .map(id => ({id, layout:placed.get(id)}))
                    .filter(item => item.layout);
                if(!parentLayouts.length) return;

                // For a merge, use the average of all upstream right edges so the merge
                // node centers between its parents. For a normal single-parent chain this
                // is identical to the parent's right edge.
                const parentRightSum = parentLayouts.reduce((sum, p) => sum + p.layout.x + p.layout.width, 0);
                const avgRight = parentRightSum / parentLayouts.length;
                const anchor = parentLayouts.reduce((best, current) => {
                    const currentRight = current.layout.x + current.layout.width;
                    const bestRight = best.layout.x + best.layout.width;
                    return Math.abs(currentRight - avgRight) < Math.abs(bestRight - avgRight) ? current : best;
                });
                const gridSlot = childGridSlotByEdge.get(`${anchor.id}\u0000${node.id}`) || {x:0, y:0};
                let x = avgRight + horizontalGap + gridSlot.x;
                const y = anchor.layout.y + gridSlot.y;
                const rootIds = new Set(parentLayouts.flatMap(item => [...item.layout.rootIds]));

                // Same-root chains push each other right to avoid overlap. Cross-chain
                // nodes also get a basic push when they fully overlap, preventing
                // unrelated branches from stacking on top of each other.
                placed.forEach(other => {
                    const sharesRoot = [...rootIds].some(rootId => other.rootIds.has(rootId));
                    const overlapsVertically = y < other.y + other.height && y + height > other.y;
                    if(overlapsVertically){
                        if(sharesRoot){
                            x = Math.max(x, other.x + other.width + horizontalGap);
                        } else {
                            const xOverlap = x < other.x + other.width && x + width > other.x;
                            if(xOverlap){
                                x = Math.max(x, other.x + other.width + horizontalGap);
                            }
                        }
                    }
                });

                moves.push({id:node.id, x, y});
                placed.set(node.id, {x, y, width, height, rootIds});
            });
        });
        // When all selected nodes are roots (no internal connections), arrange them
        // in a horizontal row from the leftmost node, top-aligned (like E key's baseline).
        if(moves.length === 0 && fixedRootIds.size === selected.length && selected.length >= 2){
            // Find the leftmost node as the anchor
            const anchor = selected.slice().sort((a, b) => {
                const aRect = rects.get(a.id) || {};
                const bRect = rects.get(b.id) || {};
                return (Number(aRect.x) || 0) - (Number(bRect.x) || 0)
                    || (Number(aRect.y) || 0) - (Number(bRect.y) || 0)
                    || String(a.id).localeCompare(String(b.id));
            })[0];
            const anchorRect = rects.get(anchor.id) || {};
            const anchorX = Number(anchorRect.x) || 0;
            const anchorY = Number(anchorRect.y) || 0;
            // Sort remaining by created_at for stable order
            const remaining = selected.filter(n => n.id !== anchor.id).slice().sort((a, b) => {
                return (Number(a.created_at) || 0) - (Number(b.created_at) || 0)
                    || String(a.id).localeCompare(String(b.id));
            });
            moves.push({id:anchor.id, x:anchorX, y:anchorY});
            let x = anchorX + (Number(anchorRect.width) || 180) + horizontalGap;
            remaining.forEach(node => {
                const rect = rects.get(node.id) || {};
                const width = Number(rect.width) || 180;
                moves.push({id:node.id, x, y:anchorY});
                x += width + horizontalGap;
            });
        }
        return moves;
    }

    function arrangeByConnections(ids, nodes, connections, rectForNode, options={}){
        const orderedIds = options.preFiltered ? ids : existingNodeIds(ids, nodes);
        const selectedIds = new Set(orderedIds);
        const nodesById = new Map((nodes || []).filter(node => node?.id).map(node => [node.id, node]));
        const selected = orderedIds.map(id => nodesById.get(id)).filter(Boolean);
        if(selected.length < 2) return [];

        const layoutConnections = (connections || []).filter(connection => isLayoutConnection(connection)
            && selectedIds.has(connection?.from) && selectedIds.has(connection?.to));
        const adjacency = new Map(selected.map(node => [node.id, []]));
        layoutConnections.forEach(connection => {
            adjacency.get(connection.from)?.push(connection.to);
            adjacency.get(connection.to)?.push(connection.from);
        });

        const components = [];
        const visited = new Set();
        selected.forEach(seed => {
            if(visited.has(seed.id)) return;
            const queue = [seed.id];
            const memberIds = [];
            visited.add(seed.id);
            while(queue.length){
                const id = queue.shift();
                memberIds.push(id);
                (adjacency.get(id) || []).forEach(nextId => {
                    if(visited.has(nextId)) return;
                    visited.add(nextId);
                    queue.push(nextId);
                });
            }
            components.push(memberIds);
        });

        if(components.length < 2 || options.clusterPack === false){
            return arrangeSingleConnectedGroup(orderedIds, nodes, connections, rectForNode, options);
        }

        // Stage 1: compact every selected connected chain independently while
        // keeping its own upstream roots as fixed anchors.
        const planned = new Map();
        const plannedRect = node => {
            const rect = rectForNode(node) || {};
            const target = planned.get(node.id);
            if(!target) return rect;
            return {...rect, x:target.x, y:target.y};
        };
        const internalMoves = [];
        components.forEach(componentIds => {
            const moves = arrangeSingleConnectedGroup(
                componentIds,
                nodes,
                connections,
                plannedRect,
                { ...options, preFiltered:true, clusterPack:false, avoidObstacles:false }
            );
            const movedById = new Map(moves.map(move => [move.id, move]));
            componentIds.forEach(id => {
                const node = nodesById.get(id);
                const rect = rectForNode(node) || {};
                const move = movedById.get(id);
                planned.set(id, {
                    x:Number.isFinite(Number(move?.x)) ? Number(move.x) : (Number(rect.x) || 0),
                    y:Number.isFinite(Number(move?.y)) ? Number(move.y) : (Number(rect.y) || 0)
                });
            });
            internalMoves.push(...moves);
        });

        const groupRectForNode = node => plannedRect(node);
        const groups = components.map(memberIds => {
            const members = memberIds.map(id => nodesById.get(id)).filter(Boolean);
            const roots = members.filter(node => !layoutConnections.some(connection =>
                connection.to === node.id && memberIds.includes(connection.from)
            ));
            const sortedRoots = roots.slice().sort((left, right) => {
                const leftRect = groupRectForNode(left) || {};
                const rightRect = groupRectForNode(right) || {};
                return (Number(leftRect.y) || 0) - (Number(rightRect.y) || 0)
                    || (Number(leftRect.x) || 0) - (Number(rightRect.x) || 0)
                    || String(left.id).localeCompare(String(right.id));
            });
            const representative = sortedRoots[0] || members[0];
            const memberRects = members.map(node => ({node, rect:groupRectForNode(node) || {}}));
            const x = Math.min(...memberRects.map(item => Number(item.rect.x) || 0));
            const y = Math.min(...memberRects.map(item => Number(item.rect.y) || 0));
            const right = Math.max(...memberRects.map(item => (Number(item.rect.x) || 0) + (Number(item.rect.width) || 0)));
            const bottom = Math.max(...memberRects.map(item => (Number(item.rect.y) || 0) + (Number(item.rect.height) || 0)));
            const rootRect = groupRectForNode(representative) || {};
            return {
                memberIds,
                x,
                y,
                width:Math.max(180, right - x),
                height:Math.max(110, bottom - y),
                rootX:Number(rootRect.x) || x,
                rootY:Number(rootRect.y) || y,
                rootId:representative?.id || memberIds[0]
            };
        }).sort((left, right) => {
            // Chain order is top-to-bottom, then left-to-right.
            return left.rootY - right.rootY
                || left.rootX - right.rootX
                || String(left.rootId).localeCompare(String(right.rootId));
        });

        // Stage 2: place whole chains in a four-row grid. Reading order
        // determines slots, while the leftmost chain remains the baseline.
        const maxRows = options.maxNodesPerColumn || 4;
        const horizontalGap = options.horizontalGap || 160;
        const verticalGap = options.verticalGap || 110;
        const columnWidths = [];
        const rowHeights = Array.from({length:maxRows}, () => 0);
        groups.forEach((group, index) => {
            const column = Math.floor(index / maxRows);
            const row = index % maxRows;
            columnWidths[column] = Math.max(columnWidths[column] || 0, group.width);
            rowHeights[row] = Math.max(rowHeights[row], group.height);
        });
        const columnOffsets = [];
        let xOffset = 0;
        columnWidths.forEach((width, column) => {
            columnOffsets[column] = xOffset;
            xOffset += width + horizontalGap;
        });
        const rowOffsets = [];
        let yOffset = 0;
        rowHeights.forEach((height, row) => {
            rowOffsets[row] = yOffset;
            yOffset += height + verticalGap;
        });

        const baselineIndex = groups.reduce((bestIndex, group, index) => {
            const best = groups[bestIndex];
            return group.x < best.x
                || (group.x === best.x && (group.y < best.y
                    || (group.y === best.y && String(group.rootId).localeCompare(String(best.rootId)) < 0)))
                ? index
                : bestIndex;
        }, 0);
        const baseline = groups[baselineIndex];
        const baselineColumn = Math.floor(baselineIndex / maxRows);
        const baselineRow = baselineIndex % maxRows;
        const gridOriginX = baseline.x - (columnOffsets[baselineColumn] || 0);
        const gridOriginY = baseline.y - (rowOffsets[baselineRow] || 0);
        const targetGroups = [];
        groups.forEach((group, index) => {
            const row = index % maxRows;
            const column = Math.floor(index / maxRows);
            targetGroups.push({
                group,
                x:gridOriginX + (columnOffsets[column] || 0),
                y:gridOriginY + (rowOffsets[row] || 0)
            });
        });

        const placedGroups = [];
        const externalObstacles = (nodes || []).filter(node => node?.id && !selectedIds.has(node.id))
            .map(node => {
                const rect = rectForNode(node) || {};
                return {
                    x:Number(rect.x) || 0,
                    y:Number(rect.y) || 0,
                    width:Number(rect.width) || 180,
                    height:Math.max(110, Number(rect.height) || 0)
                };
            });
        const overlaps = (left, right) => left.x < right.x + right.width
            && left.x + left.width > right.x
            && left.y < right.y + right.height
            && left.y + left.height > right.y;

        const finalMoves = new Map(internalMoves.map(move => [move.id, move]));
        targetGroups.forEach(({group, x, y}, index) => {
            const target = {
                x,
                y,
                width:group.width,
                height:group.height
            };
            if(index > 0){
                let blocked = true;
                while(blocked){
                    blocked = externalObstacles.some(obstacle => overlaps(target, obstacle))
                        || placedGroups.some(placedGroup => overlaps(target, placedGroup));
                    if(blocked) target.x += group.width + horizontalGap;
                }
            }
            placedGroups.push(target);
            const dx = target.x - group.x;
            const dy = target.y - group.y;
            group.memberIds.forEach(id => {
                const current = planned.get(id) || {x:0, y:0};
                const node = nodesById.get(id);
                const original = rectForNode(node) || {};
                const x = current.x + dx;
                const y = current.y + dy;
                if(x !== (Number(original.x) || 0) || y !== (Number(original.y) || 0)){
                    finalMoves.set(id, {id, x, y});
                }
            });
        });

        return [...finalMoves.values()];
    }

    function minimumAlignmentSelection(mode){
        return mode === 'distribute-h' || mode === 'distribute-v' ? 3 : 2;
    }

    function alignmentGroups(nodes, connections=[], rectForNode){
        const selected = (nodes || []).filter(Boolean);
        const nodesById = new Map(selected.map(node => [node.id, node]));
        const adjacency = new Map(selected.map(node => [node.id, []]));
        (connections || []).forEach(connection => {
            const from = connection?.from;
            const to = connection?.to;
            if(!nodesById.has(from) || !nodesById.has(to) || from === to) return;
            adjacency.get(from).push(to);
            adjacency.get(to).push(from);
        });

        const getRect = typeof rectForNode === 'function' ? rectForNode : node => node;
        const visited = new Set();
        const groups = [];
        selected.forEach(seed => {
            if(visited.has(seed.id)) return;
            const queue = [seed.id];
            const memberIds = [];
            visited.add(seed.id);
            while(queue.length){
                const id = queue.shift();
                memberIds.push(id);
                (adjacency.get(id) || []).forEach(nextId => {
                    if(visited.has(nextId)) return;
                    visited.add(nextId);
                    queue.push(nextId);
                });
            }
            const members = memberIds.map(id => {
                const node = nodesById.get(id);
                return {node, rect:getRect(node) || {}};
            });
            const x = Math.min(...members.map(item => Number(item.rect.x) || 0));
            const y = Math.min(...members.map(item => Number(item.rect.y) || 0));
            const right = Math.max(...members.map(item => (Number(item.rect.x) || 0) + (Number(item.rect.width) || 0)));
            const bottom = Math.max(...members.map(item => (Number(item.rect.y) || 0) + (Number(item.rect.height) || 0)));
            groups.push({members, x, y, width:right - x, height:bottom - y});
        });
        return groups;
    }

    function alignmentGroupCount(nodes, connections=[]){
        return alignmentGroups(nodes, connections).length;
    }

    function alignmentMoves(mode, nodes, rectForNode, connections=[]){
        const groups = alignmentGroups(nodes, connections, rectForNode);
        if(groups.length < minimumAlignmentSelection(mode)) return [];
        const minX = Math.min(...groups.map(group => group.x));
        const maxRight = Math.max(...groups.map(group => group.x + group.width));
        const minY = Math.min(...groups.map(group => group.y));
        const maxBottom = Math.max(...groups.map(group => group.y + group.height));
        const leftmostAnchor = groups.slice().sort((left, right) => left.x - right.x
            || left.y - right.y
            || String(left.members[0].node.id).localeCompare(String(right.members[0].node.id)))[0];
        const topmostAnchor = groups.slice().sort((top, bottom) => top.y - bottom.y
            || top.x - bottom.x
            || String(top.members[0].node.id).localeCompare(String(bottom.members[0].node.id)))[0];
        const movesForGroup = (group, dx=0, dy=0) => group.members.map(item => ({
            id:item.node.id,
            x:(Number(item.rect.x) || 0) + dx,
            y:(Number(item.rect.y) || 0) + dy
        }));

        // E uses leftmost group as anchor (top-align); V uses topmost group as anchor (left-align).
        // Connected groups remain atomic during the move.
        if(mode === 'left'){
            return groups.flatMap(group => movesForGroup(group, topmostAnchor.x - group.x, 0));
        }
        if(mode === 'top'){
            return groups.flatMap(group => movesForGroup(group, 0, leftmostAnchor.y - group.y));
        }
        if(mode === 'distribute-h'){
            const ordered = groups.slice().sort((left, right) => left.x - right.x || String(left.members[0].node.id).localeCompare(String(right.members[0].node.id)));
            const widths = ordered.reduce((sum, group) => sum + group.width, 0);
            const gap = (maxRight - minX - widths) / (ordered.length - 1);
            let x = minX;
            return ordered.flatMap(group => {
                const moves = movesForGroup(group, x - group.x, 0);
                x += group.width + gap;
                return moves;
            });
        }
        if(mode === 'distribute-v'){
            const ordered = groups.slice().sort((top, bottom) => top.y - bottom.y || String(top.members[0].node.id).localeCompare(String(bottom.members[0].node.id)));
            const heights = ordered.reduce((sum, group) => sum + group.height, 0);
            const gap = (maxBottom - minY - heights) / (ordered.length - 1);
            let y = minY;
            return ordered.flatMap(group => {
                const moves = movesForGroup(group, 0, y - group.y);
                y += group.height + gap;
                return moves;
            });
        }
        return [];
    }

    function childGridOffset(children, rectForNode, slotIndex, pendingRect, options={}){
        const maxNodesPerColumn = options.maxNodesPerColumn || 4;
        const horizontalGap = options.horizontalGap || 160;
        const verticalGap = options.verticalGap || 110;
        const getRect = typeof rectForNode === 'function' ? rectForNode : node => node;

        const sorted = (children || []).slice().sort((left, right) => {
            return (Number(left.created_at) || 0) - (Number(right.created_at) || 0)
                || String(left.id).localeCompare(String(right.id));
        });

        const columnWidths = [];
        const rowHeights = Array.from({length: maxNodesPerColumn}, () => 0);

        sorted.forEach((child, i) => {
            const rect = getRect(child) || {};
            const column = Math.floor(i / maxNodesPerColumn);
            const row = i % maxNodesPerColumn;
            const width = Number(rect.width) || 180;
            const height = Math.max(110, Number(rect.height) || 0);
            columnWidths[column] = Math.max(columnWidths[column] || 0, width);
            rowHeights[row] = Math.max(rowHeights[row], height);
        });

        const pendingColumn = Math.floor(slotIndex / maxNodesPerColumn);
        const pendingRow = slotIndex % maxNodesPerColumn;

        if(pendingRect){
            columnWidths[pendingColumn] = Math.max(columnWidths[pendingColumn] || 0, Number(pendingRect.width) || 180);
            rowHeights[pendingRow] = Math.max(rowHeights[pendingRow], Math.max(110, Number(pendingRect.height) || 0));
        }

        const maxColumn = Math.max(pendingColumn, columnWidths.length - 1);

        const columnOffsets = [];
        let xOffset = 0;
        for(let c = 0; c <= maxColumn; c++){
            columnOffsets[c] = xOffset;
            xOffset += (columnWidths[c] || 260) + horizontalGap;
        }

        const rowOffsets = [];
        let yOffset = 0;
        for(let r = 0; r < maxNodesPerColumn; r++){
            rowOffsets[r] = yOffset;
            yOffset += (rowHeights[r] || 260) + verticalGap;
        }

        return {
            x: columnOffsets[pendingColumn] || 0,
            y: rowOffsets[pendingRow] || 0
        };
    }

    global.SmartCanvasNodeGeometryPrimitives = Object.freeze({
        nodeRect,
        singleImageAspectRatio,
        resetSingleImageAspect,
        existingNodeIds,
        connectedClusterIds,
        arrangeByConnections,
        minimumAlignmentSelection,
        alignmentGroupCount,
        alignmentMoves,
        childGridOffset
    });
})(window);
