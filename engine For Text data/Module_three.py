import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns

def generate_histogram(df, x_col, hue_col=None):
    sns.set_theme(style="whitegrid")
    fig = plt.figure(figsize=(10, 6))

    sns.histplot(
        data=df, x=x_col, hue=hue_col, bins=20, kde=True,
        multiple="stack", stat="percent", palette="muted",
        edgecolor="white", alpha=0.85
    )

    plt.title(f"Distribution of {x_col}", fontsize=14, fontweight="bold")
    plt.xlabel(x_col, fontsize=12)
    plt.ylabel("Percentage (%)", fontsize=12)
    sns.despine()
    plt.tight_layout()
    return fig

def generate_boxplot(df, y_col, x_col=None):
    sns.set_theme(style="darkgrid")
    fig = plt.figure(figsize=(8, 6))

    sns.boxplot(data=df, x=x_col, y=y_col, palette="coolwarm", orient="v")

    title_text = f"Boxplot of {y_col}" + (f" across {x_col}" if x_col else "")
    plt.title(title_text, fontsize=14, fontweight="bold")
    plt.xlabel(x_col if x_col else "", fontsize=12)
    plt.ylabel(y_col, fontsize=12)
    sns.despine()
    plt.tight_layout()
    return fig

def generate_scatterplot(df, x_col, y_col, hue_col=None):
    sns.set_theme(style="whitegrid")
    fig = plt.figure(figsize=(10, 6))

    sns.scatterplot(
        data=df, x=x_col, y=y_col, hue=hue_col, style=hue_col,
        palette="deep", s=100, alpha=0.8
    )

    plt.title(f"{x_col} vs {y_col}", fontsize=14, fontweight="bold")
    plt.xlabel(x_col, fontsize=12)
    plt.ylabel(y_col, fontsize=12)
    sns.despine()
    plt.tight_layout()
    return fig

def generate_heatmap(df):
    sns.set_theme(style="white")
    fig = plt.figure(figsize=(10, 8))

    numeric_df = df.select_dtypes(include=[np.number])
    corr_matrix = numeric_df.corr()

    sns.heatmap(
        corr_matrix, annot=True, fmt=".2f", cmap="coolwarm",
        linewidths=0.5, cbar=True, square=True
    )

    plt.title("Feature Correlation Heatmap", fontsize=14, fontweight="bold")
    plt.tight_layout()
    return fig

def generate_linechart(df, x_col, y_col, hue_col=None):
    sns.set_theme(style="whitegrid")
    fig = plt.figure(figsize=(10, 6))

    sns.lineplot(
        data=df, x=x_col, y=y_col, hue=hue_col,
        palette="magma", marker="o", errorbar=None
    )

    plt.title(f"Trend of {y_col} over {x_col}", fontsize=14, fontweight="bold")
    plt.xlabel(x_col, fontsize=12)
    plt.ylabel(y_col, fontsize=12)
    sns.despine()
    plt.tight_layout()
    return fig