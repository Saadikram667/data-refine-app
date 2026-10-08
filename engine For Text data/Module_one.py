import os
import pandas as pd
import numpy as np
import seaborn as sns
import matplotlib.pyplot as plt

def GetDataSet(dataset_path):
    """Loads dataset dynamically based on its file extension."""
    if not os.path.exists(dataset_path):
        raise FileNotFoundError(f"Error: The file path '{dataset_path}' does not exist.")

    ext = os.path.splitext(dataset_path)[1].lower()
    loaders = {
        ".csv": pd.read_csv,
        ".xlsx": pd.read_excel,
        ".xls": pd.read_excel,
        ".json": pd.read_json,
    }

    if ext in loaders:
        return loaders[ext](dataset_path)
    else:
        raise ValueError("The dataset format must be one of: '.csv', '.xlsx', '.xls', '.json'")

def PrintingInformation(df):
    """Extracts summary metrics and missing value row indices for each column."""
    Column_list = df.columns.tolist()
    Datainfo = {}

    for col in Column_list:
        series = df[col]
        info = {
            "DataType": series.dtype.name,
            "Total Values": series.size,
            "Total Null": series.isnull().sum()
        }
        
        if pd.api.types.is_numeric_dtype(series):
            info["Median Value"] = series.median()
            info["Min"] = series.min()
            info["Max"] = series.max()
        elif pd.api.types.is_datetime64_any_dtype(series):
            info["Min Date"] = series.min()
            info["Max Date"] = series.max()
        else:
            info["Unique Values"] = series.nunique()

        Datainfo[col] = info

    Datahilight = {col: df[df[col].isnull()].index.tolist() for col in Column_list}
    DataDuplicateCount = df.duplicated().sum()

    return Datainfo, Datahilight, Column_list, DataDuplicateCount 

def SaveGraphAndTable(highlight, df, html_path="data_report.html", plot_path="missing_plot.png"):
    """Generates an HTML report and saves a missing values plot without blocking the app."""
    def highlight_nulls(x):
        style_df = pd.DataFrame('', index=x.index, columns=x.columns)
        for col, rows in highlight.items():
            if col in style_df.columns:
                style_df.loc[rows, col] = 'background-color: #ffcccc;'
        return style_df

    # Save HTML report
    styled_df = df.style.apply(highlight_nulls, axis=None)
    styled_df.to_html(html_path)

    # Aggregating null values for Seaborn plot
    null_counts = df.isnull().sum().reset_index()
    null_counts.columns = ['Column', 'NullCount']

    sns.set_theme(style="darkgrid")
    plt.figure(figsize=(10, 5))
    sns.barplot(data=null_counts, x='Column', y='NullCount')
    plt.xticks(rotation=45, ha='right')
    plt.title("Missing Values Count per Column")
    plt.xlabel("Columns")
    plt.ylabel("Null Count")
    plt.tight_layout()
    
    # Save instead of blocking execution with plt.show()
    plt.savefig(plot_path)
    plt.close()
    
    return html_path, plot_path