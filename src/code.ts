// Keep window dimensions wide to prevent any scrolling
figma.showUI(__html__, { width: 680, height: 640 });

let selectedNodes: SceneNode[] = [];

function analyzeStrokes(node: SceneNode): number {
  let maxStroke = 0;
  if ("strokeWeight" in node && typeof node.strokeWeight === 'number') {
    maxStroke = Math.max(maxStroke, node.strokeWeight);
  }
  if ("children" in node) {
    for (const child of node.children) {
      maxStroke = Math.max(maxStroke, analyzeStrokes(child as SceneNode));
    }
  }
  return maxStroke;
}

function applyStrokes(node: SceneNode, newStrokeWeight: number) {
  if ("strokeWeight" in node && typeof node.strokeWeight === 'number' && node.strokeWeight > 0) {
    node.strokeWeight = newStrokeWeight;
  }
  if ("children" in node) {
    for (const child of node.children) {
      applyStrokes(child as SceneNode, newStrokeWeight);
    }
  }
}

function outlineAllStrokes(node: SceneNode) {
  if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION' || node.type === 'LINE' || node.type === 'ELLIPSE' || node.type === 'POLYGON' || node.type === 'STAR') {
    try { node.outlineStroke(); } catch (e) { }
  }
  if ("children" in node) {
    for (const child of node.children) {
      outlineAllStrokes(child as SceneNode);
    }
  }
}

function updateSelection() {
  const selection = figma.currentPage.selection;
  const validNodes = selection.filter(node => ['FRAME', 'COMPONENT', 'GROUP', 'VECTOR'].indexOf(node.type) !== -1);

  if (validNodes.length === 0) {
    selectedNodes = [];
    figma.ui.postMessage({ type: 'NO_SELECTION' });
    return;
  }

  selectedNodes = validNodes;
  
  if (validNodes.length === 1) {
    const node = validNodes[0];
    figma.ui.postMessage({ 
      type: 'SELECTION_INFO', 
      count: 1,
      name: node.name,
      width: Math.round(node.width),
      height: Math.round(node.height),
      strokeWidth: analyzeStrokes(node)
    });
  } else {
    figma.ui.postMessage({ type: 'SELECTION_INFO', count: validNodes.length });
  }
}

figma.on('selectionchange', updateSelection);
updateSelection();

const weightMultipliers: Record<string, number> = {
  'light': 0.75,
  'regular': 1.0,
  'bold': 1.5
};

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'GENERATE' && selectedNodes.length > 0) {
    const { sizes, weights, opticalCorrection, snapGrid, outlineStrokes, outputType } = msg;
    
    const finalNodesToSelect: SceneNode[] = []; 
    let globalStartY = selectedNodes[0].y; 

    for (const originalNode of selectedNodes) {
      const baseWidth = originalNode.width;
      const baseStrokeWidth = analyzeStrokes(originalNode);
      const baseName = originalNode.name.replace(/_\d+px$/, '').replace(/\/\d+$/, '').trim();
      
      let currentX = snapGrid ? Math.round(originalNode.x + baseWidth + 80) : originalNode.x + baseWidth + 80;
      const generatedComponents: ComponentNode[] = [];

      for (const weight of weights) {
        for (const targetSize of sizes) {
          
          const clone = originalNode.clone() as FrameNode | ComponentNode | GroupNode | VectorNode;
          const scaleFactor = targetSize / baseWidth;
          
          if (clone.type === 'FRAME' || clone.type === 'COMPONENT') {
              const group = figma.group([clone], clone.parent!);
              group.resize(group.width * scaleFactor, group.height * scaleFactor);
              figma.ungroup(group);
          } else {
              clone.resize(clone.width * scaleFactor, clone.height * scaleFactor);
          }

          let finalStroke = baseStrokeWidth * scaleFactor; 
          finalStroke = finalStroke * weightMultipliers[weight]; 
          
          if (opticalCorrection && targetSize <= 16) {
            finalStroke = finalStroke * 1.15;
          }

          const roundedStroke = Math.round(finalStroke * 2) / 2;
          applyStrokes(clone, roundedStroke);

          if (snapGrid) {
            clone.x = Math.round(clone.x);
            clone.y = Math.round(clone.y);
            clone.resize(Math.round(clone.width), Math.round(clone.height));
          }

          if (outlineStrokes) {
            outlineAllStrokes(clone);
          }

          const variantName = `Size=${targetSize}, Weight=${weight.charAt(0).toUpperCase() + weight.slice(1)}`;

          if (outputType === 'variants') {
            let variantComponent: ComponentNode;
            if (clone.type === 'COMPONENT') {
              variantComponent = clone;
              variantComponent.name = variantName;
            } else {
              variantComponent = figma.createComponent();
              variantComponent.resize(clone.width, clone.height);
              variantComponent.name = variantName;
              variantComponent.appendChild(clone);
              clone.x = 0; clone.y = 0;
            }
            
            variantComponent.x = currentX;
            variantComponent.y = globalStartY;
            generatedComponents.push(variantComponent);
          } else {
            clone.name = `Icon / ${baseName} / ${weight} / ${targetSize}`;
            clone.x = currentX;
            clone.y = globalStartY;
            finalNodesToSelect.push(clone);
          }

          currentX += targetSize + 24; 
        }
        currentX += 40; 
      }

      if (outputType === 'variants' && generatedComponents.length > 0) {
        const componentSet = figma.combineAsVariants(generatedComponents, figma.currentPage);
        componentSet.name = `${baseName} System`;
        componentSet.x = snapGrid ? Math.round(originalNode.x + baseWidth + 80) : originalNode.x + baseWidth + 80;
        componentSet.y = globalStartY;
        
        componentSet.layoutMode = "HORIZONTAL";
        componentSet.primaryAxisSizingMode = "AUTO";
        componentSet.counterAxisSizingMode = "AUTO";
        componentSet.itemSpacing = 24;
        componentSet.paddingLeft = 24;
        componentSet.paddingRight = 24;
        componentSet.paddingTop = 24;
        componentSet.paddingBottom = 24;

        finalNodesToSelect.push(componentSet);
      }

      globalStartY += 120; 
    }

    figma.currentPage.selection = finalNodesToSelect;
    figma.viewport.scrollAndZoomIntoView(finalNodesToSelect);
    
    // Updated friendly toast message
    figma.notify(`✨ Success! Scaled and perfected ${sizes.length * weights.length * selectedNodes.length} icons.`);
  }
};
