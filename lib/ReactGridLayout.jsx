// @flow
import React from 'react';
import isEqual from 'lodash.isequal';
import {bottom, clone, compact, getLayoutItem, moveElement,
  synchronizeLayoutWithChildren, validateLayout} from './utils';
import GridItem from './GridItem';

// Types
import type {ResizeEvent, DragEvent} from './utils';
// End Types

/**
 * A reactive, fluid grid layout with draggable, resizable components.
 */

const ReactGridLayout = React.createClass({
  propTypes: {
    //
    // Basic props
    //
    layouts: React.PropTypes.object,
    className: React.PropTypes.string,
    style: React.PropTypes.object,
    width: React.PropTypes.number.isRequired,
    offsetY: React.PropTypes.number.isRequired,
    offsetX: React.PropTypes.number.isRequired,

    // If true, the container height swells and contracts to fit contents
    autoSize: React.PropTypes.bool,
    // # of cols.
    cols: React.PropTypes.number,

    // A selector that will not be draggable.
    draggableCancel: React.PropTypes.string,
    // A selector for the draggable handler
    draggableHandle: React.PropTypes.string,

    // If true, the layout will compact vertically
    verticalCompact: React.PropTypes.bool,

    // layout is an array of object with the format:
    // {x: Number, y: Number, w: Number, h: Number, i: Number}
    layout: function (props) {
      var layout = props.layout;
      // I hope you're setting the _grid property on the grid items
      if (layout === undefined) return;
      validateLayout(layout, 'layout');
    },

    // margin between items [x, y] in px
    margin: React.PropTypes.array,
    // Rows have a static height, but you can change this based on breakpoints if you like
    rowHeight: React.PropTypes.number,

    //
    // Flags
    //
    isDraggable: React.PropTypes.bool,
    isResizable: React.PropTypes.bool,
    // Use CSS transforms instead of top/left
    useCSSTransforms: React.PropTypes.bool,

    //
    // Callbacks
    //

    // Callback so you can save the layout.
    // Calls back with (currentLayout, allLayouts). allLayouts are keyed by breakpoint.
    onLayoutChange: React.PropTypes.func,

    // Calls when drag starts. Callback is of the signature (layout, oldItem, newItem, placeholder, e).
    // All callbacks below have the same signature. 'start' and 'stop' callbacks omit the 'placeholder'.
    onDragStart: React.PropTypes.func,
    // Calls on each drag movement.
    onDrag: React.PropTypes.func,
    // Calls when drag is complete.
    onDragStop: React.PropTypes.func,
    //Calls when resize starts.
    onResizeStart: React.PropTypes.func,
    // Calls when resize movement happens.
    onResize: React.PropTypes.func,
    // Calls when resize is complete.
    onResizeStop: React.PropTypes.func,

    //
    // Other validations
    //

    // Children must not have duplicate keys.
    children: function (props, propName, _componentName) {
      React.PropTypes.node.apply(this, arguments);
      var children = props[propName];

      // Check children keys for duplicates. Throw if found.
      var keys = {};
      React.Children.forEach(children, function (child) {
        if (keys[child.key]) {
          throw new Error("Duplicate child key found! This will cause problems in ReactGridLayout.");
        }
        keys[child.key] = true;
      });
    }
  },

  getDefaultProps() {
    return {
      autoSize: true,
      cols: 12,
      rowHeight: 150,
      layout: [],
      margin: [10, 10],
      isDraggable: true,
      isResizable: true,
      useCSSTransforms: true,
      verticalCompact: true,
      onLayoutChange: function () {
      },
      onDragStart: function () {
      },
      onDrag: function () {
      },
      onDragStop: function () {
      },
      onResizeStart: function () {
      },
      onResize: function () {
      },
      onResizeStop: function () {
      }
    };
  },

  getInitialState() {
    return {
      activeDrag: null,
      isMounted: false,
      layout: synchronizeLayoutWithChildren(this.props.layout, this.props.children, this.props.cols, this.props.verticalCompact),
      oldDragItem: null,
      oldResizeItem: null
    };
  },

  componentDidMount() {
    // Call back with layout on mount. This should be done after correcting the layout width
    // to ensure we don't rerender with the wrong width.
    this.props.onLayoutChange(this.state.layout, this.props.layouts);
    this.setState({isMounted: true});
  },

  componentWillReceiveProps(nextProps:Object) {
    // Allow parent to set layout directly.
    if (!isEqual(nextProps.layout, this.state.layout)) {
      this.setState({
        layout: synchronizeLayoutWithChildren(nextProps.layout, nextProps.children, nextProps.cols, nextProps.verticalCompact)
      });
      // Call back so we can store the layout
      // Do it only when a resize/drag is not active, otherwise there are way too many callbacks
      if (!this.state.activeDrag) this.props.onLayoutChange(this.state.layout, this.props.layouts);
    }
    // If children change, regenerate the layout.
    if (nextProps.children.length !== this.props.children.length) {
      this.setState({
        layout: synchronizeLayoutWithChildren(this.state.layout, nextProps.children, nextProps.cols, nextProps.verticalCompact)
      });
    }
  },

  /**
   * Calculates a pixel value for the container.
   * @return {String} Container height in pixels.
   */
  containerHeight() {
    if (!this.props.autoSize) return;
    return bottom(this.state.layout) * this.props.rowHeight + this.props.margin[1] + 'px';
  },

  /**
   * When dragging starts
   * @param {String} i Id of the child
   * @param {Number} x X position of the move
   * @param {Number} y Y position of the move
   * @param {Event} e The mousedown event
   * @param {Element} node The current dragging DOM element
   */
  onDragStart(i:string, x:number, y:number, {e, node}: DragEvent) {
    const {layout} = this.state;
    var l = getLayoutItem(layout, i);
    if (!l) return;

    this.setState({oldDragItem: clone(l)});

    this.props.onDragStart(layout, l, l, null, e, node);
  },
  /**
   * Each drag movement create a new dragelement and move the element to the dragged location
   * @param {String} i Id of the child
   * @param {Number} x X position of the move
   * @param {Number} y Y position of the move
   * @param {Event} e The mousedown event
   * @param {Element} node The current dragging DOM element
   */
  onDrag(i:string, x:number, y:number, {e, node}: DragEvent) {
    const {oldDragItem} = this.state;
    let {layout} = this.state;
    var l = getLayoutItem(layout, i);
    if (!l) return;

    // Create placeholder (display only)
    var placeholder = {
      w: l.w, h: l.h, x: l.x, y: l.y, placeholder: true, i: i
    };

    // Move the element to the dragged location.
    layout = moveElement(layout, l, x, y, true /* isUserAction */);

    this.props.onDrag(layout, oldDragItem, l, placeholder, e, node);

    this.setState({
      layout: compact(layout, this.props.verticalCompact),
      activeDrag: placeholder
    });
  },

  /**
   * When dragging stops, figure out which position the element is closest to and update its x and y.
   * @param  {String} i Index of the child.
   * @param {Number} x X position of the move
   * @param {Number} y Y position of the move
   * @param {Event} e The mousedown event
   * @param {Element} node The current dragging DOM element
   */
  onDragStop(i:string, x:number, y:number, {e, node}: DragEvent) {
    const {oldDragItem} = this.state;
    let {layout} = this.state;
    let l = getLayoutItem(layout, i);
    if (!l) return;

    // Move the element here
    layout = moveElement(layout, l, x, y, true /* isUserAction */);

    this.props.onDragStop(layout, oldDragItem, l, null, e, node);

    // Set state
    this.setState({
      layout: compact(layout, this.props.verticalCompact),
      activeDrag: null,
      oldDragItem: null
    });
  },

  onResizeStart(i:string, w:number, h:number, {e, element}: ResizeEvent) {
    const {layout} = this.state;
    var l = getLayoutItem(layout, i);
    if (!l) return;

    this.setState({oldResizeItem: clone(l)});

    this.props.onResizeStart(layout, l, l, null, e, element);
  },

  onResize(i:string, w:number, h:number, {e, element}: ResizeEvent) {
    const {layout, oldResizeItem} = this.state;
    var l = getLayoutItem(layout, i);
    if (!l) return;

    // Set new width and height.
    l.w = w;
    l.h = h;

    // Create placeholder element (display only)
    var placeholder = {
      w: w, h: h, x: l.x, y: l.y, placeholder: true, i: i
    };

    this.props.onResize(layout, oldResizeItem, l, placeholder, e, element);

    // Re-compact the layout and set the drag placeholder.
    this.setState({layout: compact(layout, this.props.verticalCompact), activeDrag: placeholder});
  },

  onResizeStop(i:string, w:number, h:number, {e, element}: ResizeEvent) {
    const {layout, oldResizeItem} = this.state;
    var l = getLayoutItem(layout, i);

    this.props.onResizeStop(layout, oldResizeItem, l, null, e, element);

    this.setState({
      layout: compact(layout, this.props.verticalCompact),
      activeDrag: null,
      oldResizeItem: null
    });
  },


  /**
   * Create a placeholder object.
   * @return {Element} Placeholder div.
   */
  placeholder() {
    const {activeDrag} = this.state;
    if (!activeDrag) return null;
    const {width, offsetX, offsetY, cols, margin, rowHeight, useCSSTransforms} = this.props;

    // {...this.state.activeDrag} is pretty slow, actually
    return (
      <GridItem
        w={activeDrag.w}
        h={activeDrag.h}
        x={activeDrag.x}
        y={activeDrag.y}
        i={activeDrag.i}
        isPlaceholder={true}
        className="react-grid-placeholder"
        containerWidth={width}
        offsetX={offsetX}
        offsetY={offsetY}
        cols={cols}
        margin={margin}
        rowHeight={rowHeight}
        isDraggable={false}
        isResizable={false}
        useCSSTransforms={useCSSTransforms}>
        <div />
      </GridItem>
    );
  },

  /**
   * Given a grid item, set its style attributes & surround in a <Draggable>.
   * @param  {Element} child React element.
   * @return {Element}       Element wrapped in draggable and properly placed.
   */
  processGridItem(child:ReactElement){
    if (!child.key) return;
    const l = getLayoutItem(this.state.layout, child.key);
    if (!l) return;
    const {width, offsetX, offsetY, cols, margin, rowHeight, useCSSTransforms, draggableCancel, draggableHandle} = this.props;

    // Parse 'static'. Any properties defined directly on the grid item will take precedence.
    const draggable = (l.static || !this.props.isDraggable) ? false : true;
    const resizable = (l.static || !this.props.isResizable) ? false : true;

    return (
      <GridItem
        containerWidth={width}
        offsetX={offsetX}
        offsetY={offsetY}
        cols={cols}
        margin={margin}
        rowHeight={rowHeight}
        cancel={draggableCancel}
        handle={draggableHandle}
        onDragStop={this.onDragStop}
        onDragStart={this.onDragStart}
        onDrag={this.onDrag}
        onResizeStart={this.onResizeStart}
        onResize={this.onResize}
        onResizeStop={this.onResizeStop}
        isDraggable={draggable}
        isResizable={resizable}
        useCSSTransforms={useCSSTransforms && this.state.isMounted}
        usePercentages={!this.state.isMounted}
        {...l}>
        {child}
      </GridItem>
    );
  },

  render() {
    const {className, style} = this.props;

    const mergedClassName = `react-grid-layout ${className}`;
    const mergedStyle = {
      height: this.containerHeight(),
      ...style
    };

    return (
      <div className={mergedClassName} style={mergedStyle}>
        {React.Children.map(this.props.children, this.processGridItem)}
        {this.placeholder()}
      </div>
    );
  }
});

export default ReactGridLayout;
